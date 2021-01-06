import HttpError from "http-errors"
import { Layer, LayerOptions } from "./layer"
import { Key, pathToRegexp } from "path-to-regexp"
import { IHttpServerComponent as http } from "@well-known-components/interfaces"
import { compose, Middleware } from "./middleware"
import { methodsList } from "./methods"

export type RouterOptions = Partial<{
  methods: http.HTTPMethod[]
  prefix: string
  routerPath: string
  sensitive: boolean
  strict: boolean
}>
export type AllowedMethodOptions = Partial<{
  throw: boolean
  notImplemented: NewableFunction
  methodNotAllowed: NewableFunction
}>

const injectedMiddlewareRouterSymbol = Symbol("injected-router")

export function getInjectedRouter<C>(middleware: Middleware<C>): Router<C> | null {
  return (middleware as any)[injectedMiddlewareRouterSymbol] || null
}
export function setInjectedRouter<C>(middleware: Middleware<C>, router: Router<any>) {
  ;(middleware as any)[injectedMiddlewareRouterSymbol] = router
}

export type RoutedContext<Context, Path extends string> = http.PathAwareContext<Context, Path> & {
  // TODO: move to HTTP
  method: http.HTTPMethod
  path: string
  // --

  // @internal
  router: Router<any>
  routerName?: string

  // capture groups from the url
  captures: string[]

  // @internal
  _matchedRoute?: string
  _matchedRouteName?: string
  matched?: Layer<Context>[]
  routerPath?: string
}

function createMethodHandler(router: Router<any>, method: http.HTTPMethod): http.PathAwareHandler<any> {
  return function (path, middleware: Middleware<any>) {
    router.register(path, [method], middleware, {})
  }
}

/**
 * Create a new router.
 *
 * @example
 *
 * Basic usage:
 *
 * ```javascript
 * const Koa = require('koa');
 * const Router = require('@koa/router');
 *
 * const app = new Koa();
 * const router = new Router();
 *
 * router.get('/', (ctx, next) => {
 *   // ctx.router available
 * });
 *
 * app
 *   .use(router.routes())
 *   .use(router.allowedMethods());
 * ```
 *
 * @alias module:koa-router
 * @param {Object=} opts
 * @param {String=} opts.prefix prefix router paths
 * @constructor
 */

export class Router<Context> implements http.MethodHandlers<Context> {
  opts: RouterOptions
  methods: http.HTTPMethod[]
  // params: Record<string, Middleware<http.DefaultContext<Context>>> = {}
  stack: Layer<Context>[] = []
  constructor(opts?: RouterOptions) {
    this.opts = opts || {}
    this.methods = this.opts.methods || ["HEAD", "OPTIONS", "GET", "PUT", "PATCH", "POST", "DELETE"]
  }

  connect = createMethodHandler(this, "CONNECT")
  delete = createMethodHandler(this, "DELETE")
  get = createMethodHandler(this, "GET")
  head = createMethodHandler(this, "HEAD")
  options = createMethodHandler(this, "OPTIONS")
  patch = createMethodHandler(this, "PATCH")
  post = createMethodHandler(this, "POST")
  put = createMethodHandler(this, "PUT")
  trace = createMethodHandler(this, "TRACE")

  /**
   * Use given middleware.
   *
   * Middleware run in the order they are defined by `.use()`. They are invoked
   * sequentially, requests start at the first middleware and work their way
   * "down" the middleware stack.
   *
   * @example
   *
   * ```javascript
   * // session middleware will run before authorize
   * router
   *   .use(session())
   *   .use(authorize());
   *
   * // use middleware only with given path
   * router.use('/users', userAuth());
   *
   * // or with an array of paths
   * router.use(['/users', '/admin'], userAuth());
   *
   * app.use(router.routes());
   * ```
   *
   * @param {String=} path
   * @param {Function} middleware
   * @param {Function=} ...
   * @returns {Router}
   */

  use(...middlewares: Middleware<Context>[]): this
  use<P extends string>(route: P, ...middlewares: Middleware<Context>[]): this
  use(): this {
    const middleware: Middleware<Context>[] = Array.prototype.slice.call(arguments)
    let path: string | undefined
    let router = this

    const hasPath = typeof middleware[0] === "string"
    if (hasPath) path = (middleware.shift() as any) as string

    for (let i = 0; i < middleware.length; i++) {
      const m = middleware[i]
      const injectedRouter = getInjectedRouter(m)
      if (injectedRouter) {
        const cloneRouter = Object.assign(Object.create(Router.prototype), injectedRouter, {
          stack: injectedRouter.stack.slice(0),
        })

        for (let j = 0; j < cloneRouter.stack.length; j++) {
          const nestedLayer = cloneRouter.stack[j]
          const cloneLayer = Object.assign(Object.create(Layer.prototype), nestedLayer)

          if (path) cloneLayer.setPrefix(path)
          if (router.opts.prefix) cloneLayer.setPrefix(router.opts.prefix)
          router.stack.push(cloneLayer)
          cloneRouter.stack[j] = cloneLayer
        }
      } else {
        const keys: Key[] = []
        pathToRegexp(router.opts.prefix || "", keys)
        const routerPrefixHasParam = router.opts.prefix && keys.length
        router.register(path || "([^/]*)", [], m, { end: false, ignoreCaptures: !hasPath && !routerPrefixHasParam })
      }
    }

    return this
  }

  /**
   * Set the path prefix for a Router instance that was already initialized.
   *
   * @example
   *
   * ```javascript
   * router.prefix('/things/:thing_id')
   * ```
   *
   * @param {String} prefix
   * @returns {Router}
   */

  prefix(prefix: string): this {
    prefix = prefix.replace(/\/$/, "")

    this.opts.prefix = prefix

    for (let i = 0; i < this.stack.length; i++) {
      const route = this.stack[i]
      route.setPrefix(prefix)
    }

    return this
  }

  /**
   * Returns router middleware which dispatches a route matching the request.
   *
   * @returns {Function}
   */

  routes(): Middleware<RoutedContext<http.DefaultContext<Context>, string>> {
    const router = this

    let dispatch = function dispatch(
      ctx: RoutedContext<http.DefaultContext<Context>, string>,
      next: () => Promise<http.IResponse>
    ) {
      // debug("%s %s", ctx.method, ctx.path)

      const path = router.opts.routerPath || ctx.routerPath || ctx.path
      const matched = router.match(path, ctx.method)
      let layerChain: Middleware<RoutedContext<http.DefaultContext<Context>, string>>[]

      if (ctx.matched) {
        ctx.matched.push.apply(ctx.matched, matched.path)
      } else {
        ctx.matched = matched.path
      }

      ctx.router = router

      if (!matched.route) return next()

      const matchedLayers = matched.pathAndMethod
      const mostSpecificLayer = matchedLayers[matchedLayers.length - 1]
      ctx._matchedRoute = mostSpecificLayer.path
      if (mostSpecificLayer.name) {
        ctx._matchedRouteName = mostSpecificLayer.name
      }

      layerChain = matchedLayers.reduce(function (memo, layer) {
        memo.push(async function (ctx, next) {
          ctx.captures = layer.captures(path)
          ctx.params = ctx.params = layer.params(ctx.captures, ctx.params)
          ctx.routerPath = layer.path
          ctx.routerName = layer.name || undefined
          ctx._matchedRoute = layer.path
          if (layer.name) {
            ctx._matchedRouteName = layer.name
          }
          return await next()
        })
        return memo.concat(layer.stack)
      }, [] as typeof layerChain)

      return compose(...layerChain)(ctx, next)
    }

    setInjectedRouter(dispatch, this)

    return dispatch
  }

  /**
   * Returns separate middleware for responding to `OPTIONS` requests with
   * an `Allow` header containing the allowed methods, as well as responding
   * with `405 Method Not Allowed` and `501 Not Implemented` as appropriate.
   *
   * @example
   *
   * ```javascript
   * const Koa = require('koa');
   * const Router = require('@koa/router');
   *
   * const app = new Koa();
   * const router = new Router();
   *
   * app.use(router.routes());
   * app.use(router.allowedMethods());
   * ```
   *
   * **Example with [Boom](https://github.com/hapijs/boom)**
   *
   * ```javascript
   * const Koa = require('koa');
   * const Router = require('@koa/router');
   * const Boom = require('boom');
   *
   * const app = new Koa();
   * const router = new Router();
   *
   * app.use(router.routes());
   * app.use(router.allowedMethods({
   *   throw: true,
   *   notImplemented: () => new Boom.notImplemented(),
   *   methodNotAllowed: () => new Boom.methodNotAllowed()
   * }));
   * ```
   *
   * @param {Object=} options
   * @param {Boolean=} options.throw throw error instead of setting status and header
   * @param {Function=} options.notImplemented throw the returned value in place of the default NotImplemented error
   * @param {Function=} options.methodNotAllowed throw the returned value in place of the default MethodNotAllowed error
   * @returns {Function}
   */

  allowedMethods(options: AllowedMethodOptions = {}): Function {
    options = options || {}
    const implemented = this.methods

    return async function allowedMethods(
      ctx: RoutedContext<http.DefaultContext<Context>, string>,
      next: () => Promise<http.IResponse>
    ) {
      const response = await next()

      const allowed: Partial<Record<string, string>> = {}

      if (!response.status || response.status === 404) {
        if (ctx.matched) {
          for (let i = 0; i < ctx.matched.length; i++) {
            const route = ctx.matched[i]
            for (let j = 0; j < route.methods.length; j++) {
              const method = route.methods[j]
              allowed[method] = method
            }
          }
        }

        const allowedArr = Object.keys(allowed)

        if (!~implemented.indexOf(ctx.method)) {
          if (options.throw) {
            let notImplementedThrowable =
              typeof options.notImplemented === "function"
                ? options.notImplemented() // set whatever the user returns from their function
                : new HttpError.NotImplemented()

            throw notImplementedThrowable
          } else {
            return {
              status: 501,
              headers: { Allow: allowedArr.join(", ") },
            }
          }
        } else if (allowedArr.length) {
          if (ctx.method === "OPTIONS") {
            return {
              status: 200,
              body: "",
              headers: { Allow: allowedArr.join(", ") },
            }
          } else if (!allowed[ctx.method]) {
            if (options.throw) {
              let notAllowedThrowable =
                typeof options.methodNotAllowed === "function"
                  ? options.methodNotAllowed() // set whatever the user returns from their function
                  : new HttpError.MethodNotAllowed()

              throw notAllowedThrowable
            } else {
              return {
                status: 405,
                headers: { Allow: allowedArr.join(", ") },
              }
            }
          }
        }
      }
    }
  }

  /**
   * Register route with all methods.
   *
   * @param {String} name Optional.
   * @param {String} path
   * @param {Function=} middleware You may also pass multiple middleware.
   * @param {Function} callback
   * @returns {Router}
   * @private
   */

  all(path: string, middleware: Middleware<Context>): this {
    this.register(path, methodsList, middleware, {})

    return this
  }

  /**
   * Redirect `source` to `destination` URL with optional 30x status `code`.
   *
   * Both `source` and `destination` can be route names.
   *
   * ```javascript
   * router.redirect('/login', 'sign-in');
   * ```
   *
   * This is equivalent to:
   *
   * ```javascript
   * router.all('/login', ctx => {
   *   ctx.redirect('/sign-in');
   *   ctx.status = 301;
   * });
   * ```
   *
   * @param {String} source URL or route name.
   * @param {String} destination URL or route name.
   * @param {Number=} code HTTP status code (default: 301).
   * @returns {Router}
   */

  redirect(source: string, destination: string, code?: number): this {
    // lookup source route by name
    if (source[0] !== "/") throw new Error(`Relative URL must start with / got ${JSON.stringify(source)} instead`)

    // lookup destination route by name
    if (destination[0] !== "/" && !destination.includes("://"))
      throw new Error(
        `Can't resolve target URL, it is neither a relative or absolute URL. Got ${JSON.stringify(source)}`
      )

    return this.all(source, async (ctx) => {
      return { status: code || 302, headers: { Location: destination } }
    })
  }

  /**
   * Create and register a route.
   *
   * @param {String} path Path string.
   * @param {Array.<String>} methods Array of HTTP verbs.
   * @param {Function} middleware Multiple middleware also accepted.
   * @returns {Router}
   * @private
   */

  register(
    path: string,
    methods: ReadonlyArray<http.HTTPMethod>,
    middleware: Middleware<Context>,
    opts?: LayerOptions
  ): Layer<Context> {
    opts = opts || {}

    const router = this
    const stack = this.stack

    // support array of paths
    if (Array.isArray(path)) {
      for (let i = 0; i < path.length; i++) {
        const curPath = path[i]
        router.register.call(router, curPath, methods, middleware, opts)
      }
    }

    // create route
    const route = new Layer(path, methods, middleware, {
      end: opts.end === false ? opts.end : true,
      name: opts.name,
      sensitive: opts.sensitive || this.opts.sensitive || false,
      strict: opts.strict || this.opts.strict || false,
      prefix: opts.prefix || this.opts.prefix || "",
      ignoreCaptures: opts.ignoreCaptures,
    })

    if (this.opts.prefix) {
      route.setPrefix(this.opts.prefix)
    }

    stack.push(route)

    // debug("defined route %s %s", route.methods, route.path)

    return route
  }

  /**
   * Lookup route with given `name`.
   *
   * @param {String} name
   * @returns {Layer|null}
   */

  route(name: string): Layer<Context> | null {
    const routes = this.stack

    for (let len = routes.length, i = 0; i < len; i++) {
      if (routes[i].name && routes[i].name === name) return routes[i]
    }

    return null
  }

  /**
   * Match given `path` and return corresponding routes.
   *
   * @param {String} path
   * @param {String} method
   * @returns {Object.<path, pathAndMethod>} returns layers that matched path and
   * path and method.
   * @private
   */

  match(path: string, method: http.HTTPMethod) {
    const layers = this.stack
    let layer: Layer<Context>

    const matched = {
      path: [] as Layer<Context>[],
      pathAndMethod: [] as Layer<Context>[],
      route: false,
    }

    for (let len = layers.length, i = 0; i < len; i++) {
      layer = layers[i]

      // debug("test %s %s", layer.path, layer.regexp)

      if (layer.match(path)) {
        matched.path.push(layer)

        if (layer.methods.length === 0 || ~layer.methods.indexOf(method)) {
          matched.pathAndMethod.push(layer)
          if (layer.methods.length) matched.route = true
        }
      }
    }

    return matched
  }
}

// /**
//  * Generate URL from url pattern and given `params`.
//  *
//  * @example
//  *
//  * ```javascript
//  * const url = Router.url('/users/:id', {id: 1});
//  * // => "/users/1"
//  * ```
//  *
//  * @param {String} path url pattern
//  * @param {Object} params url parameters
//  * @returns {String}
//  */
// export function processUrl(path: string, ...rest: any[]): string {
//   return Layer.prototype.url.apply({ path }, rest)
// }

// /**
//  * Create `router.verb()` methods, where *verb* is one of the HTTP verbs such
//  * as `router.get()` or `router.post()`.
//  *
//  * Match URL patterns to callback functions or controller actions using `router.verb()`,
//  * where **verb** is one of the HTTP verbs such as `router.get()` or `router.post()`.
//  *
//  * Additionaly, `router.all()` can be used to match against all methods.
//  *
//  * ```javascript
//  * router
//  *   .get('/', (ctx, next) => {
//  *     ctx.body = 'Hello World!';
//  *   })
//  *   .post('/users', (ctx, next) => {
//  *     // ...
//  *   })
//  *   .put('/users/:id', (ctx, next) => {
//  *     // ...
//  *   })
//  *   .del('/users/:id', (ctx, next) => {
//  *     // ...
//  *   })
//  *   .all('/users/:id', (ctx, next) => {
//  *     // ...
//  *   });
//  * ```
//  *
//  * When a route is matched, its path is available at `ctx._matchedRoute` and if named,
//  * the name is available at `ctx._matchedRouteName`
//  *
//  * Route paths will be translated to regular expressions using
//  * [path-to-regexp](https://github.com/pillarjs/path-to-regexp).
//  *
//  * Query strings will not be considered when matching requests.
//  *
//  * #### Named routes
//  *
//  * Routes can optionally have names. This allows generation of URLs and easy
//  * renaming of URLs during development.
//  *
//  * ```javascript
//  * router.get('user', '/users/:id', (ctx, next) => {
//  *  // ...
//  * });
//  *
//  * router.url('user', 3);
//  * // => "/users/3"
//  * ```
//  *
//  * #### Multiple middleware
//  *
//  * Multiple middleware may be given:
//  *
//  * ```javascript
//  * router.get(
//  *   '/users/:id',
//  *   (ctx, next) => {
//  *     return User.findOne(ctx.params.id).then(function(user) {
//  *       ctx.user = user;
//  *       next();
//  *     });
//  *   },
//  *   ctx => {
//  *     console.log(ctx.user);
//  *     // => { id: 17, name: "Alex" }
//  *   }
//  * );
//  * ```
//  *
//  * ### Nested routers
//  *
//  * Nesting routers is supported:
//  *
//  * ```javascript
//  * const forums = new Router();
//  * const posts = new Router();
//  *
//  * posts.get('/', (ctx, next) => {...});
//  * posts.get('/:pid', (ctx, next) => {...});
//  * forums.use('/forums/:fid/posts', posts.routes(), posts.allowedMethods());
//  *
//  * // responds to "/forums/123/posts" and "/forums/123/posts/123"
//  * app.use(forums.routes());
//  * ```
//  *
//  * #### Router prefixes
//  *
//  * Route paths can be prefixed at the router level:
//  *
//  * ```javascript
//  * const router = new Router({
//  *   prefix: '/users'
//  * });
//  *
//  * router.get('/', ...); // responds to "/users"
//  * router.get('/:id', ...); // responds to "/users/:id"
//  * ```
//  *
//  * #### URL parameters
//  *
//  * Named route parameters are captured and added to `ctx.params`.
//  *
//  * ```javascript
//  * router.get('/:category/:title', (ctx, next) => {
//  *   console.log(ctx.params);
//  *   // => { category: 'programming', title: 'how-to-node' }
//  * });
//  * ```
//  *
//  * The [path-to-regexp](https://github.com/pillarjs/path-to-regexp) module is
//  * used to convert paths to regular expressions.
//  *
//  * @name get|put|post|patch|delete|del
//  * @memberof module:koa-router.prototype
//  * @param {String} path
//  * @param {Function=} middleware route middleware(s)
//  * @param {Function} callback route callback
//  * @returns {Router}
//  */

// for (let i = 0; i < methods.length; i++) {
//   function setMethodVerb(method) {
//     Router.prototype[method] = function (path, middleware: Middleware<any>) {
//       this.register(path, [method], middleware, {})

//       return this
//     }
//   }
//   setMethodVerb(methods[i])
// }

// // Alias for `router.delete()` because delete is a reserved word
// Router.prototype.del = Router.prototype["delete"]

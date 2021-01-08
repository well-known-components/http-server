import HttpError from "http-errors"
import { Layer, LayerOptions } from "./layer"
import { Key, pathToRegexp } from "path-to-regexp"
import type { IHttpServerComponent, IMiddlewareAdapterHandler } from "@well-known-components/interfaces"
import { compose, Middleware } from "./middleware"
import { methodsList } from "./methods"

/** @public */
export type RouterOptions = Partial<{
  methods: IHttpServerComponent.HTTPMethod[]
  prefix: string
  routerPath: string
  sensitive: boolean
  strict: boolean
}>
/** @public */
export type AllowedMethodOptions = Partial<{
  /// throw error instead of setting status and header
  throw: boolean
  /// throw the returned value in place of the default NotImplemented error
  notImplemented: NewableFunction
  /// throw the returned value in place of the default MethodNotAllowed error
  methodNotAllowed: NewableFunction
}>

const injectedMiddlewareRouterSymbol = Symbol("injected-router")

/** @internal */
function getInjectedRouter<C>(middleware: Middleware<C>): Router<C> | null {
  return (middleware as any)[injectedMiddlewareRouterSymbol] || null
}

/** @internal */
function setInjectedRouter<C>(middleware: Middleware<C>, router: Router<any>) {
  ;(middleware as any)[injectedMiddlewareRouterSymbol] = router
}

/** @public */
export type RoutedContext<Context, Path extends string> = IHttpServerComponent.PathAwareContext<Context, Path> & {
  // TODO: move to HTTP
  method: IHttpServerComponent.HTTPMethod
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

/** @public */
export type RoutePathSignature<Context> = <T extends string>(
  path: T,
  middleware: IHttpServerComponent.IRequestHandler<RoutedContext<Context, T>>
) => void

function createMethodHandler<Context>(
  router: Router<Context>,
  method: IHttpServerComponent.HTTPMethod
): RoutePathSignature<Context> {
  return function (path, middleware) {
    router.register(path, [method], middleware as IHttpServerComponent.IRequestHandler<Context>, {})
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
 * const app = createTestServerComponent();
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
 * @public
 */

export class Router<Context extends {}> implements IHttpServerComponent.MethodHandlers<Context> {
  opts: RouterOptions
  methods: IHttpServerComponent.HTTPMethod[]
  // params: Record<string, Middleware<http.DefaultContext<Context>>> = {}
  stack: Layer<Context>[] = []
  constructor(opts?: RouterOptions) {
    this.opts = opts || {}
    this.methods = this.opts.methods || ["HEAD", "OPTIONS", "GET", "PUT", "PATCH", "POST", "DELETE"]
  }

  connect = createMethodHandler<Context>(this, "CONNECT")
  delete = createMethodHandler<Context>(this, "DELETE")
  get = createMethodHandler<Context>(this, "GET")
  head = createMethodHandler<Context>(this, "HEAD")
  options = createMethodHandler<Context>(this, "OPTIONS")
  patch = createMethodHandler<Context>(this, "PATCH")
  post = createMethodHandler<Context>(this, "POST")
  put = createMethodHandler<Context>(this, "PUT")
  trace = createMethodHandler<Context>(this, "TRACE")

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
   * @param path -
   * @param middleware -
   */

  use(...middlewares: IHttpServerComponent.IRequestHandler<RoutedContext<Context, string>>[]): this
  use<P extends string>(route: P, ...middlewares: IHttpServerComponent.IRequestHandler<RoutedContext<Context, P>>[]): this
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
   * @param prefix -
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
   */

  routes(): IHttpServerComponent.IRequestHandler<Context> {
    const router = this

    const routerMiddleware: IHttpServerComponent.IRequestHandler<
      RoutedContext<Context, any>
    > = function routerMiddleware(ctx, next) {
      // debug("%s %s", ctx.method, ctx.path)

      const path = router.opts.routerPath || ctx.routerPath || ctx.path
      const matched = router.match(path, ctx.method)
      let layerChain: Middleware<RoutedContext<IHttpServerComponent.DefaultContext<Context>, string>>[]

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

    setInjectedRouter(routerMiddleware, this)

    return routerMiddleware as IHttpServerComponent.IRequestHandler<Context>
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
   * const app = createTestServerComponent();
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
   * const app = createTestServerComponent();
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
   * @param options -
   */

  allowedMethods(options: AllowedMethodOptions = {}): IHttpServerComponent.IRequestHandler<Context> {
    options = options || {}
    const implemented = this.methods

    const routerMiddleware: IHttpServerComponent.IRequestHandler<
      RoutedContext<Context, any>
    > = async function routerMiddleware(ctx, next) {
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
    return routerMiddleware
  }

  /**
   * Register route with all methods.
   *
   * @param name - Optional.
   * @param path -
   * @param middleware - You may also pass multiple middleware.
   * @param callback -
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
   * @param source - URL or route name.
   * @param destination - URL or route name.
   * @param code - HTTP status code (default: 301).
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
   * @param path - Path string.
   * @param methods - Array of HTTP verbs.
   * @param middleware - Multiple middleware also accepted.
   */

  register(
    path: string,
    methods: ReadonlyArray<IHttpServerComponent.HTTPMethod>,
    middleware: IHttpServerComponent.IRequestHandler<Context>,
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
   * @param name -
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
   * @param path -
   * @param method -
   */

  match(path: string, method: IHttpServerComponent.HTTPMethod) {
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
//  * @param path - url pattern
//  * @param params - url parameters
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
//  *     return ctx.body = 'Hello World!';
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
//  * @param path -
//  * @param middleware - route middleware(s)
//  * @param callback - route callback
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

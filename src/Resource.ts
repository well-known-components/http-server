import 'reflect-metadata'

import { IHttpServerComponent } from '@well-known-components/interfaces'
import HttpErrors from 'http-errors'
import { Router } from './router'
import { Middleware } from './middleware'

const RESOURCE_PREFIX = 'resource:prefix'
const RESOURCE_METHOD = 'resource:method'
const RESOURCE_ROUTE = 'resource:route'
const RESOURCE_HANDLERS = 'resource:handlers'
const RESOURCE_MIDDLEWARES = 'resource:middlewares'
const RESOURCE_ARGUMENT_EXTRACTORS = 'resource:argumentextractors'

type HandlerReturnType = Promise<IHttpServerComponent.IResponse>

type AsyncRequestHandlersOf<T extends object> = {
  [K in keyof T]: T[K] extends (...args: any[]) => HandlerReturnType ? K : never;
}[keyof T]

type AsyncResourceDecorator<Base extends Resource = Resource> =
  <T extends Base, K extends AsyncRequestHandlersOf<T>, V>(classPrototype: T, propertyKey: K, descriptor?: TypedPropertyDescriptor<V>) => void

type ParameterDecorator =
  <Base extends Resource, K extends AsyncRequestHandlersOf<Base>>(target: Base, propertyKey: K, parameterIndex: number) => void

type ClassDecorator = <TFunction extends new (...args: any) => Resource>(target: TFunction) => TFunction | void

type Extractor<Context = any> = (context: Context) => Promise<any>

function getOrCreateMetadata<V, T extends object>(key: string, target: T, gen: () => V): V {
  const ret = Reflect.getMetadata(key, target) ?? gen()
  Reflect.defineMetadata(key, ret, target)
  return ret
}

function getMiddlewares(target: object): any[] {
  return getOrCreateMetadata(RESOURCE_MIDDLEWARES, target, () => [])
}

function getHandlerSet(target: object): Set<string | symbol | number> {
  return getOrCreateMetadata(RESOURCE_HANDLERS, target, () => new Set())
}

function getParamExtractors<T extends CallableFunction>(target: T): Array<Extractor | null> {
  return getOrCreateMetadata(RESOURCE_ARGUMENT_EXTRACTORS, target, () => new Array(target.length).map((_) => null))
}

function defineParamExtractor(target: any, method: any, paramIndex: number, extractor: Extractor<IHttpServerComponent.DefaultContext>) {
  const args = getParamExtractors(target[method])
  if (args[paramIndex]) {
    throw new Error(`Parameter #${paramIndex} of ${target.constructor.name} already defined`)
  }
  args[paramIndex] = extractor
}

/**
 * @public
 */
export type ApiDefinition = {
  prefix: string
  instance: Resource
  middlewares: any[]
  resources: ApiDefinitionEntry[]
  metadata: Array<[string, any]>
}

/**
 * @public
 */
export type ApiDefinitionEntry = {
  httpMethod: string
  httpRoute: string
  handlerName: string | symbol | number
  middlewares: any[]
  delegate(context: any): HandlerReturnType
  metadata: Array<[string, any]>
}

/**
 * @public
 */
export abstract class Resource {
  static Handler: (method: IHttpServerComponent.HTTPMethod, route: string) => AsyncResourceDecorator =
    (httpMethod, httpRoute) =>
      (resource, method, _descriptor) => {
        if (typeof httpRoute != 'string' || !httpRoute.startsWith('/'))
          throw new Error('http route must start with /')
        Reflect.defineMetadata(RESOURCE_METHOD, httpMethod, resource[method] as any)
        Reflect.defineMetadata(RESOURCE_ROUTE, httpRoute, resource[method] as any)
        getHandlerSet(resource).add(method)
      }

  static UrlParam = (param: string): ParameterDecorator =>
    (target, method, paramIndex) => {
      defineParamExtractor(target, method, paramIndex, async (ctx) => {
        const ret = (ctx as any).params[param]
        if (ret === undefined) {
          throw new HttpErrors.InternalServerError(`Could not resolve param ${param}`)
        }
        return ret
      })
    }

  static RequestContext: ParameterDecorator =
    (target, method, paramIndex) => {
      defineParamExtractor(target, method, paramIndex, async (ctx) => {
        return ctx
      })
    }

  /**
   * Uses all provided middlewares for the annotated target.
   * - In resources, all handlers will use the middleware.
   * - In methods, only the annotated target will use the middleware.
   */
  static WithMiddleware: (middlware: Middleware<any>) => ClassDecorator & AsyncResourceDecorator =
    (middleware) => function(target: any, key?: string | number | symbol) {
      if (typeof key === 'undefined') {
        getMiddlewares(target).unshift(middleware)
      } else {
        getMiddlewares(target[key]).unshift(middleware)
      }
    }

  /**
   * Annotates the resource setting a prefix for the URL.
   */
  static Prefix: (prefix: string) => ClassDecorator = (prefix) =>
    (target: any) => {
      if (typeof prefix != 'string' || !prefix.startsWith('/'))
        throw new Error('prefix must start with /')
      Reflect.defineMetadata(RESOURCE_PREFIX, prefix, target)
    }

  static getApiDefinition(res: Resource): ApiDefinition {
    const prototype = Object.getPrototypeOf(res)

    const prefix = Reflect.getMetadata(RESOURCE_PREFIX, res.constructor)

    const middlewares = getMiddlewares(prototype.constructor)

    const ret: ApiDefinition = {
      middlewares,
      prefix,
      instance: res,
      resources: [],
      metadata: Reflect.getMetadataKeys(prototype.constructor).sort().map(key => [key, Reflect.getMetadata(key, prototype.constructor)])
    }

    for (const handler of getHandlerSet(prototype)) {
      const impl: any = (res as any)[handler]
      const method: IHttpServerComponent.HTTPMethod = Reflect.getMetadata(RESOURCE_METHOD, impl).toUpperCase()
      const route: string = Reflect.getMetadata(RESOURCE_ROUTE, impl)

      const paramExtractors = getParamExtractors(impl)
      paramExtractors.forEach(($, ix) => {
        if (!$) {
          throw new Error(
            `The method ${String(handler)} is lacking an annotation for the parameter #${ix}.\n` +
            `The router does not know how to fulfill that parameter.`
          )
        }
      })

      const delegate = async (context: any) => {
        const args: any[] = []
        for (const extractor of paramExtractors) {
          args.push(await extractor!(context))
        }
        return await impl.apply(res, args)
      }

      const middlewares = getMiddlewares(prototype[handler])
      const entry: ApiDefinitionEntry = {
        middlewares,
        delegate,
        httpRoute: route,
        httpMethod: method,
        handlerName: handler,
        metadata: Reflect.getMetadataKeys(prototype[handler]).sort().map(key => [key, Reflect.getMetadata(key, prototype[handler])])
      }
      ret.resources.push(entry)
    }

    return ret
  }

  /**
   * Creates a new router for the API definition of this Resource.
   */
  createRouter() {
    const router = new Router()

    const api = Resource.getApiDefinition(this)

    if (api.prefix) {
      router.prefix(api.prefix)
    }

    if (api.middlewares.length) {
      router.use(...api.middlewares)
    }

    api.resources.forEach(($) => {
      router[$.httpMethod.toLowerCase() as keyof IHttpServerComponent.MethodHandlers<any>](
        $.httpRoute,
        ...$.middlewares,
        $.delegate
      )
    })

    return {
      router,
      api
    }
  }

  /**
   * Registers the current resource in the global router.
   */
  registerResource(globalRouter: Router<any>) {
    const { api, router } = this.createRouter()
    globalRouter.use(router.middleware())
    globalRouter.use(router.allowedMethods())

    return {
      router,
      api
    }
  }
}

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
const INTERNAL_METADATA = 'internal-metadata'
const ROOT = ':root:'

type HandlerReturnType = Promise<IHttpServerComponent.IResponse>

/**
 * @public
 */
export type AsyncRequestHandlersOf<T extends object> = {
  [K in keyof T]: T[K] extends (...args: any[]) => HandlerReturnType ? K : never;
}[keyof T]

/**
 * @public
 */
export type AsyncResourceDecorator<Base extends Resource = Resource> =
  <T extends Base, K extends AsyncRequestHandlersOf<T>, V>(classPrototype: T, propertyKey: K, descriptor?: TypedPropertyDescriptor<V>) => void

/**
 * @public
 */
export type AsyncResourceParameterDecorator =
  <Base extends Resource, K extends AsyncRequestHandlersOf<Base>>(target: Base, propertyKey: K, parameterIndex: number) => void

type ClassDecorator = <TFunction extends new (...args: any) => Resource>(target: TFunction) => TFunction | void

/**
 * @public
 */
export type Extractor<Context = any> = (context: Context) => Promise<any>

type InternalMetadata = Record<string | symbol | number, any>

function getOrCreateInternalMetadata(prototype: object, method: string | number | symbol): InternalMetadata {
  const ret: InternalMetadata = Reflect.getMetadata(INTERNAL_METADATA, prototype) ?? {}
  Reflect.defineMetadata(INTERNAL_METADATA, ret, prototype)
  ret[method] = ret[method] ?? {}
  return ret[method]
}

function getOrCreateMetadata<V, T extends object>(key: string, target: T, method: string | symbol | number, gen: () => V): V {
  const map = getOrCreateInternalMetadata(target, method)
  map[key] = map[key] ?? gen()
  return map[key]
}

function getHandlerSet(prototype: object): Set<string | symbol | number> {
  return getOrCreateMetadata(RESOURCE_HANDLERS, prototype, ROOT, () => new Set())
}

function getParamExtractors(prototype: object, method: string | number | symbol): Array<Extractor | null> {
  const fn = (prototype as any)[method] as CallableFunction
  return getOrCreateMetadata(RESOURCE_ARGUMENT_EXTRACTORS, prototype, method, () => new Array(fn.length).map((_) => null))
}

/**
 * @public
 */
export function defineParamExtractor(prototype: any, method: any, paramIndex: number, extractor: Extractor<IHttpServerComponent.DefaultContext>) {
  const args = getParamExtractors(prototype, method)
  if (args[paramIndex]) {
    throw new Error(`Parameter #${paramIndex} of ${prototype.constructor.name}.${method} already defined`)
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
      (prototype, method, _descriptor) => {
        if (typeof httpRoute != 'string' || !httpRoute.startsWith('/'))
          throw new Error('http route must start with /')
        const meta = getOrCreateInternalMetadata(prototype, method)
        meta[RESOURCE_METHOD] = httpMethod
        meta[RESOURCE_ROUTE] = httpRoute
        getHandlerSet(prototype).add(method)
      }

  static UrlParam = (param: string): AsyncResourceParameterDecorator =>
    (prototype, method, paramIndex) => {
      defineParamExtractor(prototype, method, paramIndex, async (ctx) => {
        const ret = (ctx as any).params[param]
        if (ret === undefined) {
          throw new HttpErrors.InternalServerError(`Could not resolve param ${param}`)
        }
        return ret
      })
    }

  static RequestContext: AsyncResourceParameterDecorator =
    (prototype, method, paramIndex) => {
      defineParamExtractor(prototype, method, paramIndex, async (ctx) => {
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
        getOrCreateMetadata(RESOURCE_MIDDLEWARES, target.prototype, ROOT, () => [] as Middleware<any>[]).unshift(middleware)
      } else {
        getOrCreateMetadata(RESOURCE_MIDDLEWARES, target, key, () => [] as Middleware<any>[]).unshift(middleware)
      }
    }

  /**
   * Annotates the resource setting a prefix for the URL.
   */
  static Prefix: (prefix: string) => ClassDecorator = (prefix) =>
    (target: any) => {
      if (typeof prefix != 'string' || !prefix.startsWith('/'))
        throw new Error('prefix must start with /')

      const meta = getOrCreateInternalMetadata(target.prototype, ROOT)
      meta[RESOURCE_PREFIX] = prefix
    }

  static getApiDefinition(res: Resource): ApiDefinition {
    const root = getOrCreateInternalMetadata(res, ROOT)

    const ret: ApiDefinition = {
      middlewares: root[RESOURCE_MIDDLEWARES] ?? [],
      prefix: root[RESOURCE_PREFIX],
      instance: res,
      resources: [],
      metadata: Object.keys(root).sort().map(key => [key, root[key]])
    }

    for (const handlerName of getHandlerSet(res)) {
      const paramExtractors = getParamExtractors(res, handlerName)
      paramExtractors.forEach(($, ix) => {
        if (!$) {
          throw new Error(
            `The method ${String(handlerName)} is lacking an annotation for the parameter #${ix}.\n` +
            `The router does not know how to fulfill that parameter.`
          )
        }
      })

      const impl: any = (res as any)[handlerName]
      const delegate = async (context: any) => {
        const args: any[] = []
        for (const extractor of paramExtractors) {
          args.push(await extractor!(context))
        }
        return await impl.apply(res, args)
      }

      const meta = getOrCreateInternalMetadata(res, handlerName)
      const entry: ApiDefinitionEntry = {
        middlewares: meta[RESOURCE_MIDDLEWARES] ?? [],
        delegate,
        httpRoute: meta[RESOURCE_ROUTE],
        httpMethod: meta[RESOURCE_METHOD],
        handlerName,
        metadata: Object.keys(meta).sort().map(key => [key, meta[key]])
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

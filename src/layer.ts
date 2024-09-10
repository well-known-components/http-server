import { IHttpServerComponent as http } from '@well-known-components/interfaces'
import { pathToRegexp, Key } from 'path-to-regexp'
import { Middleware } from './middleware'
import { RoutedContext } from './router'

export type LayerOptions = Partial<{
  name: string
  sensitive: boolean
  strict: boolean
  ignoreCaptures: boolean
  end: boolean
  prefix: string
}>

/**
 * Initialize a new routing Layer with given `method`, `path`, and `middleware`.
 *
 * @param path - Path string or regular expression.
 * @param methods - Array of HTTP verbs.
 * @param middleware - Layer callback/middleware or series of.
 * @param opts - Layer options
 *
 * @public
 */
export class Layer<Context, Path extends string> {
  opts: LayerOptions
  name: string | null
  methods: http.HTTPMethod[]
  paramNames: Key[]
  stack: Middleware<RoutedContext<http.DefaultContext<Context>, Path>>[]
  path: string
  regexp: RegExp

  constructor(
    path: Path,
    methods: ReadonlyArray<http.HTTPMethod>,
    middleware:
      | Middleware<RoutedContext<http.DefaultContext<Context>, Path>>
      | Middleware<RoutedContext<http.DefaultContext<Context>, Path>>[],
    opts?: LayerOptions
  ) {
    this.opts = opts || {}
    this.name = this.opts.name || null
    this.methods = []
    this.paramNames = []
    this.stack = Array.isArray(middleware) ? middleware : [middleware]

    for (let i = 0; i < methods.length; i++) {
      const l = this.methods.push(methods[i].toUpperCase() as http.HTTPMethod)
      if (this.methods[l - 1] === 'GET') this.methods.unshift('HEAD')
    }

    // ensure middleware is a function
    for (let i = 0; i < this.stack.length; i++) {
      const fn = this.stack[i]
      const type = typeof fn
      if (type !== 'function')
        throw new Error(
          `${methods.toString()} \`${this.opts.name || path}\`: \`middleware\` must be a function, not \`${type}\``
        )
    }

    this.path = path
    this.regexp = pathToRegexp(path, this.paramNames, this.opts)
  }

  /**
   * Returns whether request `path` matches route.
   *
   * @param path -
   */

  match(path: string): boolean {
    return this.regexp.test(path)
  }

  /**
   * Returns map of URL parameters for given `path` and `paramNames`.
   *
   * @param path -
   * @param captures -
   * @param existingParams -
   */

  params(captures: Array<string>, existingParams: Record<string, string>): object {
    const params = existingParams || {}

    for (let len = captures.length, i = 0; i < len; i++) {
      if (this.paramNames[i]) {
        const c = captures[i]
        params[this.paramNames[i].name] = c ? safeDecodeURIComponent(c) : c
      }
    }

    return params
  }

  /**
   * Returns array of regexp url path captures.
   *
   * @param path -
   */

  captures(path: string): Array<string> {
    const r = path.match(this.regexp)
    if (!r) return []
    return this.opts.ignoreCaptures ? [] : r.slice(1)
  }

  /**
   * Prefix route path.
   *
   * @param prefix -
   */

  setPrefix(prefix: string): this {
    if (this.path) {
      this.path = this.path !== '/' || this.opts.strict === true ? `${prefix}${this.path}` : prefix
      this.paramNames = []
      this.regexp = pathToRegexp(this.path, this.paramNames, this.opts)
    }

    return this
  }
}

/**
 * Safe decodeURIComponent, won't throw any error.
 * If `decodeURIComponent` error happen, just return the original value.
 *
 * @param text -
 */

function safeDecodeURIComponent(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch (e) {
    return text
  }
}

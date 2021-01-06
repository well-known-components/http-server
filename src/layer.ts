import { IHttpServerComponent as http } from "@well-known-components/interfaces"
import { pathToRegexp, compile, parse, Key, ParseOptions, TokensToFunctionOptions } from "path-to-regexp"
import { parse as parseUrl, format as formatUrl } from "url"
import { Middleware } from "./middleware"

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
 * @param {String|RegExp} path Path string or regular expression.
 * @param {Array} methods Array of HTTP verbs.
 * @param {Array} middleware Layer callback/middleware or series of.
 * @param {Object=} opts
 * @param {String=} opts.name route name
 * @param {String=} opts.sensitive case sensitive (default: false)
 * @param {String=} opts.strict require the trailing slash (default: false)
 *
 * @public
 */
export class Layer<Context> {
  opts: LayerOptions
  name: string | null
  methods: http.HTTPMethod[]
  paramNames: Key[]
  stack: Middleware<http.DefaultContext<Context>>[]
  path: string
  regexp: RegExp

  constructor(
    path: string,
    methods: ReadonlyArray<http.HTTPMethod>,
    middleware: Middleware<http.DefaultContext<Context>> | Middleware<http.DefaultContext<Context>>[],
    opts?: LayerOptions
  ) {
    this.opts = opts || {}
    this.name = this.opts.name || null
    this.methods = []
    this.paramNames = []
    this.stack = Array.isArray(middleware) ? middleware : [middleware]

    for (let i = 0; i < methods.length; i++) {
      const l = this.methods.push(methods[i].toUpperCase() as http.HTTPMethod)
      if (this.methods[l - 1] === "GET") this.methods.unshift("HEAD")
    }

    // ensure middleware is a function
    for (let i = 0; i < this.stack.length; i++) {
      const fn = this.stack[i]
      const type = typeof fn
      if (type !== "function")
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
   * @param {String} path
   * @returns {Boolean}
   * @private
   */

  match(path: string): boolean {
    return this.regexp.test(path)
  }

  /**
   * Returns map of URL parameters for given `path` and `paramNames`.
   *
   * @param {String} path
   * @param {Array.<String>} captures
   * @param {Object=} existingParams
   * @returns {Object}
   * @private
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
   * @param {String} path
   * @returns {Array.<String>}
   * @private
   */

  captures(path: string): Array<string> {
    const r = path.match(this.regexp)
    if (!r) return []
    return this.opts.ignoreCaptures ? [] : r.slice(1)
  }

  /**
   * Prefix route path.
   *
   * @param {String} prefix
   */

  setPrefix(prefix: string): this {
    if (this.path) {
      this.path = this.path !== "/" || this.opts.strict === true ? `${prefix}${this.path}` : prefix
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
 * @param {String} text
 * @returns {String} URL decode original string.
 * @private
 */

function safeDecodeURIComponent(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch (e) {
    return text
  }
}

import { IHttpServerComponent as http } from '@well-known-components/interfaces'

export type MethodsMapType = {
  [key in http.HTTPMethod]: key
}

export const methodsMap: MethodsMapType = Object.seal({
  CONNECT: 'CONNECT',
  DELETE: 'DELETE',
  GET: 'GET',
  HEAD: 'HEAD',
  OPTIONS: 'OPTIONS',
  PATCH: 'PATCH',
  POST: 'POST',
  PUT: 'PUT',
  TRACE: 'TRACE'
})

export const methodsList: ReadonlyArray<http.HTTPMethod> = Object.seal(
  Object.keys(methodsMap)
) as ReadonlyArray<http.HTTPMethod>

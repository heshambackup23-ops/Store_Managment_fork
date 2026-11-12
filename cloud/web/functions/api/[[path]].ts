interface ApiBinding {
  fetch(request: Request): Promise<Response>
}

export async function onRequest({ request, env }: {
  request: Request
  env: { STORE_API?: ApiBinding }
}): Promise<Response> {
  if (!env.STORE_API) {
    return Response.json({ success: false, code: 'API_UNAVAILABLE', message: 'خدمة المتجر غير متاحة مؤقتًا' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  const response = await env.STORE_API.fetch(request)
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}

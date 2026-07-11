/**
 * functions/api/checkout-mp-iniciar.js
 * GET /api/checkout-mp-iniciar
 * Devolve a Public Key do MP pro SDK inicializar o formulário de cartão.
 */
export async function onRequestGet({ env }) {
  const publicKey = env.MP_PUBLIC_KEY_TEST || env.MP_PUBLIC_KEY;
  if (!publicKey) {
    return new Response(JSON.stringify({ error: 'MP_PUBLIC_KEY não configurada.' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ publicKey }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}

// Gnollboard Save Worker — Cloudflare Workers + KV
// KV namespace binding: GNOLL_SAVES (set up in wrangler.toml or dashboard)
//
// Deploy steps:
//   1. Create a Cloudflare account at cloudflare.com (free)
//   2. Install wrangler: npm install -g wrangler
//   3. wrangler login
//   4. wrangler kv:namespace create GNOLL_SAVES  (note the id it gives you)
//   5. Create wrangler.toml (template below), paste the KV namespace id
//   6. wrangler deploy
//   7. Copy the deployed worker URL into gnollboard.html (WORKER_URL constant)
//
// wrangler.toml template:
// ─────────────────────────────────────
// name = "gnollboard-saves"
// main = "gnollboard-worker.js"
// compatibility_date = "2024-01-01"
//
// [[kv_namespaces]]
// binding = "GNOLL_SAVES"
// id = "PASTE_YOUR_KV_NAMESPACE_ID_HERE"
// ─────────────────────────────────────

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS }
    });
}

function err(msg, status = 400) {
    return json({ error: msg }, status);
}

function uid() {
    // 16-char random hex ID
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}

export default {
    async fetch(request, env) {
        // Preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS });
        }

        const url  = new URL(request.url);
        const path = url.pathname;          // e.g. /index/channel123  or  /slot/abc123
        const [, resource, id] = path.split('/');

        // ── Index (slot list per channel) ──────────────────────────────────
        if (resource === 'index') {
            if (!id) return err('Missing channel id');

            if (request.method === 'GET') {
                const val = await env.GNOLL_SAVES.get(`index:${id}`);
                return json(val ? JSON.parse(val) : []);
            }

            if (request.method === 'PUT') {
                const body = await request.json();
                if (!Array.isArray(body)) return err('Expected array');
                await env.GNOLL_SAVES.put(`index:${id}`, JSON.stringify(body));
                return json({ ok: true });
            }

            return err('Method not allowed', 405);
        }

        // ── Slot (individual save) ─────────────────────────────────────────
        if (resource === 'slot') {
            if (request.method === 'POST') {
                // Create new slot — generate ID, store payload
                const body = await request.text();
                if (!body) return err('Empty body');
                const slotId = uid();
                // KV TTL: 90 days (saves auto-expire if never touched)
                await env.GNOLL_SAVES.put(`slot:${slotId}`, body, { expirationTtl: 60 * 60 * 24 * 90 });
                return json({ id: slotId });
            }

            if (!id) return err('Missing slot id');

            if (request.method === 'GET') {
                const val = await env.GNOLL_SAVES.get(`slot:${id}`);
                if (!val) return err('Slot not found', 404);
                // Return raw compressed string
                return new Response(val, {
                    headers: { 'Content-Type': 'text/plain', ...CORS }
                });
            }

            if (request.method === 'DELETE') {
                await env.GNOLL_SAVES.delete(`slot:${id}`);
                return json({ ok: true });
            }

            return err('Method not allowed', 405);
        }

        // ── Health check ───────────────────────────────────────────────────
        if (resource === 'ping' || path === '/') {
            return json({ status: 'ok', service: 'Gnollboard Save Worker' });
        }

        return err('Not found', 404);
    }
};

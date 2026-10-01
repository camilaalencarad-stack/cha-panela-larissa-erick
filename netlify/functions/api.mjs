import { getDatabase } from "@netlify/database";
import crypto from "node:crypto";

const db = getDatabase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TOTAL_GIFTS = 40;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

function cleanText(value, max = 120) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function validGiftId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n >= 1 && n <= TOTAL_GIFTS;
}

function requireAdmin(password) {
  if (!ADMIN_PASSWORD) return { ok: false, response: json({ error: "Área administrativa ainda não configurada." }, 503) };
  if (String(password ?? "") !== ADMIN_PASSWORD) return { ok: false, response: json({ error: "Senha incorreta." }, 401) };
  return { ok: true };
}

async function publicState() {
  const rows = await db.sql`SELECT gift_id FROM gift_reservations ORDER BY gift_id ASC`;
  return { reserved: rows.map((row) => Number(row.gift_id)) };
}

async function adminData() {
  const giftRows = await db.sql`SELECT gift_id FROM gift_reservations ORDER BY gift_id ASC`;
  const rsvpRows = await db.sql`SELECT id, name, phone, created_at FROM rsvps ORDER BY created_at DESC`;
  return {
    reserved: giftRows.map((row) => Number(row.gift_id)),
    rsvps: rsvpRows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      createdAt: row.created_at
    }))
  };
}

export default async (req) => {
  try {
    if (req.method === "GET") return json(await publicState());
    if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

    const body = await req.json().catch(() => ({}));
    const action = cleanText(body.action, 40);

    if (action === "reserve") {
      const giftId = Number(body.giftId);
      if (!validGiftId(giftId)) return json({ error: "Presente inválido." }, 400);

      const token = crypto.randomUUID();
      const rows = await db.sql`
        INSERT INTO gift_reservations (gift_id, token)
        VALUES (${giftId}, ${token})
        ON CONFLICT (gift_id) DO NOTHING
        RETURNING gift_id
      `;

      if (!rows.length) return json({ error: "Este presente acabou de ser escolhido por outra pessoa." }, 409);
      return json({ ok: true, token });
    }

    if (action === "releaseOwn") {
      const giftId = Number(body.giftId);
      const token = cleanText(body.token, 100);
      if (!validGiftId(giftId) || !token) return json({ error: "Dados inválidos." }, 400);

      const rows = await db.sql`
        DELETE FROM gift_reservations
        WHERE gift_id = ${giftId} AND token = ${token}
        RETURNING gift_id
      `;

      if (!rows.length) return json({ error: "Esta escolha não pertence a este navegador." }, 403);
      return json({ ok: true });
    }

    if (action === "rsvp") {
      const name = cleanText(body.name, 80);
      const phone = cleanText(body.phone, 40);
      if (name.length < 2 || phone.replace(/\D/g, "").length < 8) {
        return json({ error: "Preencha seu nome e número de WhatsApp." }, 400);
      }

      await db.sql`
        INSERT INTO rsvps (id, name, phone)
        VALUES (${crypto.randomUUID()}, ${name}, ${phone})
      `;
      return json({ ok: true });
    }

    if (action === "adminData") {
      const auth = requireAdmin(body.password);
      if (!auth.ok) return auth.response;
      return json(await adminData());
    }

    if (action === "adminRelease") {
      const auth = requireAdmin(body.password);
      if (!auth.ok) return auth.response;
      const giftId = Number(body.giftId);
      if (!validGiftId(giftId)) return json({ error: "Presente inválido." }, 400);
      await db.sql`DELETE FROM gift_reservations WHERE gift_id = ${giftId}`;
      return json({ ok: true });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: "Não foi possível concluir agora. Tente novamente." }, 500);
  }
};

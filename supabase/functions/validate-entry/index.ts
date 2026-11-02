
import { withSupabase } from "npm:@supabase/server@1";

const CUENTA_AUTORIZADA = "d4b997a6-2267-47f0-b8d9-fbcb4fc68b9d";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respuesta(datos: unknown, status = 200) {
  return new Response(JSON.stringify(datos), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  fetch: withSupabase(
    { auth: "user" },
    async (req, ctx) => {
      if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
      }

      if (req.method !== "POST") {
        return respuesta({ error: "Método no permitido." }, 405);
      }

      try {
        const userId = ctx.userClaims?.id;

        if (typeof userId !== "string") {
          return respuesta({
            error: "Debes iniciar sesión.",
          }, 401);
        }

        const body = await req.json();

        const token = body.token;
        const deviceId = body.device_id;
        const deviceLabel = body.device_label;

        if (
          typeof token !== "string" ||
          !/^[a-f0-9]{64}$/i.test(token)
        ) {
          return respuesta({
            error: "El código QR no tiene un formato válido.",
          }, 400);
        }

        if (
          typeof deviceId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)
        ) {
          return respuesta({
            error: "Identificador de dispositivo inválido.",
          }, 400);
        }

        const label =
          typeof deviceLabel === "string"
            ? deviceLabel.trim().slice(0, 80)
            : "Dispositivo sin nombre";

        const admin = ctx.supabaseAdmin;

        // 1. Comprobar que el operador sea administrador.
        const { data: operador, error: operadorError } =
          await admin
            .from("event_admins")
            .select("user_id")
            .eq("user_id", userId)
            .maybeSingle();

        if (operadorError) {
          throw operadorError;
        }

        if (!operador) {
          return respuesta({
            error: "Tu cuenta no está autorizada para controlar entradas.",
          }, 403);
        }

        // 2. Buscar el evento activo.
        const { data: evento, error: eventoError } =
          await admin
            .from("events")
            .select("id")
            .eq("name", "Modela tu barrio")
            .eq("is_active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

        if (eventoError) {
          throw eventoError;
        }

        if (!evento) {
          return respuesta({
            error: "No se encontró un evento activo.",
          }, 404);
        }

        // 3. Buscar el dispositivo.
        const { data: dispositivo, error: dispositivoError } =
          await admin
            .from("access_devices")
            .select("id, user_id, is_approved, revoked_at")
            .eq("device_id", deviceId)
            .maybeSingle();

        if (dispositivoError) {
          throw dispositivoError;
        }

        // 4. Registrar dispositivos nuevos.
        if (!dispositivo) {
          const esPropietario = userId === CUENTA_AUTORIZADA;

          const { error: registroError } = await admin
            .from("access_devices")
            .insert({
              user_id: userId,
              device_id: deviceId,
              device_label: label,
              is_approved: esPropietario,
            });

          if (registroError) {
            throw registroError;
          }

          if (!esPropietario) {
            return respuesta({
              success: false,
              outcome: "pending_device",
              message: "Dispositivo registrado. Está pendiente de aprobación.",
            }, 403);
          }

          return respuesta({
            success: false,
            outcome: "device_registered",
            message: "Dispositivo autorizado. Escanea nuevamente el código QR.",
          });
        }

        // 5. Comprobar que el dispositivo pertenezca al operador.
        if (dispositivo.user_id !== userId) {
          return respuesta({
            error: "Este dispositivo pertenece a otro operador.",
          }, 403);
        }

        // 6. Los dispositivos revocados nunca se autorizan automáticamente.
        if (dispositivo.revoked_at !== null) {
          return respuesta({
            success: false,
            outcome: "device_revoked",
            message: "Este dispositivo ha sido revocado.",
          }, 403);
        }

        // 7. Comprobar aprobación.
        if (!dispositivo.is_approved) {
          return respuesta({
            success: false,
            outcome: "pending_device",
            message: "Este dispositivo todavía no ha sido aprobado.",
          }, 403);
        }

        // 8. Actualizar el último uso.
        const { error: actualizacionError } = await admin
          .from("access_devices")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", dispositivo.id);

        if (actualizacionError) {
          throw actualizacionError;
        }

        // 9. Calcular el hash del QR.
        const tokenHash = await hashToken(token);

        // 10. Validar la entrada mediante la función SQL.
        const { data, error: validacionError } = await admin.rpc(
          "validate_and_check_in",
          {
            p_event_id: evento.id,
            p_token_hash: tokenHash,
            p_user_id: userId,
            p_device_label: label,
          },
        );

        if (validacionError) {
          throw validacionError;
        }

        const resultado = Array.isArray(data) ? data[0] : data;

        if (!resultado) {
          throw new Error("La validación no devolvió resultados.");
        }

        const mensajes: Record<string, string> = {
          authorized: "Entrada registrada correctamente.",
          already_used: "Este QR ya fue utilizado.",
          revoked: "Esta inscripción está desactivada.",
          invalid: "El código QR no es válido.",
        };

        return respuesta({
          success: resultado.outcome === "authorized",
          outcome: resultado.outcome,
          message:
            mensajes[resultado.outcome] ??
            "No se pudo determinar el resultado.",
          attendee_name: resultado.attendee_name ?? null,
          entry_time: resultado.entry_time ?? null,
        });

      } catch (error) {
        console.error("Error en validate-entry:", error);

        return respuesta({
          error: "Ocurrió un error interno al validar la entrada.",
        }, 500);
      }
    },
  ),
};

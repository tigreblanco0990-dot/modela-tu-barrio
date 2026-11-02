
import { withSupabase } from "npm:@supabase/server@1";

const CUENTA_AUTORIZADA =
  "d4b997a6-2267-47f0-b8d9-fbcb4fc68b9d";

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

const columnas =
  "id, user_id, device_id, device_label, is_approved, created_at, last_used_at, revoked_at";

const formatoUUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default {
  fetch: withSupabase(
    { auth: "user" },
    async (req, ctx) => {
      if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
      }

      if (req.method !== "POST") {
        return respuesta({
          error: "Método no permitido.",
        }, 405);
      }

      try {
        // 1. Obtener la identidad de la sesión autenticada.
        const userId = ctx.userClaims?.id;

        if (typeof userId !== "string") {
          return respuesta({
            error: "Debes iniciar sesión.",
          }, 401);
        }

        const body = await req.json();

        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return respuesta({
            error: "Solicitud inválida.",
          }, 400);
        }

        const action = body.action;
        const admin = ctx.supabaseAdmin;

        // =====================================================
        // REGISTRAR O COMPROBAR UN DISPOSITIVO
        // =====================================================

        if (action === "register") {
          const deviceId = body.device_id;
          const deviceLabel = body.device_label;

          if (
            typeof deviceId !== "string" ||
            !formatoUUID.test(deviceId)
          ) {
            return respuesta({
              error: "Identificador de dispositivo inválido.",
            }, 400);
          }

          const label =
            typeof deviceLabel === "string"
              ? deviceLabel.trim().slice(0, 80)
              : "Dispositivo sin nombre";

          // 2. Comprobar que la cuenta sea administradora.
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
              success: false,
              status: "unauthorized",
              message:
                "Tu cuenta no está autorizada para administrar el evento.",
            }, 403);
          }

          // 3. Buscar el dispositivo.
          let { data: existente, error: busquedaError } =
            await admin
              .from("access_devices")
              .select(columnas)
              .eq("device_id", deviceId)
              .maybeSingle();

          if (busquedaError) {
            throw busquedaError;
          }

          // 4. Registrar dispositivos nuevos.
          if (!existente) {
            const esPropietario =
              userId === CUENTA_AUTORIZADA;

            const { data: nuevo, error: registroError } =
              await admin
                .from("access_devices")
                .insert({
                  user_id: userId,
                  device_id: deviceId,
                  device_label: label || "Dispositivo sin nombre",
                  is_approved: esPropietario,
                })
                .select(columnas)
                .single();

            if (registroError) {
              // Si ocurrió una solicitud simultánea,
              // volver a consultar el dispositivo.
              if (registroError.code === "23505") {
                const { data: actualizado, error: nuevoError } =
                  await admin
                    .from("access_devices")
                    .select(columnas)
                    .eq("device_id", deviceId)
                    .maybeSingle();

                if (nuevoError) {
                  throw nuevoError;
                }

                existente = actualizado;
              } else {
                throw registroError;
              }
            } else {
              return respuesta({
                success: esPropietario,
                status: esPropietario ? "approved" : "pending",
                message: esPropietario
                  ? "Dispositivo autorizado."
                  : "Tu dispositivo está pendiente de aprobación.",
                device: nuevo,
              });
            }
          }

          // 5. Comprobar que el dispositivo pertenezca
          // al mismo administrador que inició sesión.
          if (existente.user_id !== userId) {
            return respuesta({
              success: false,
              status: "unauthorized",
              message:
                "Este dispositivo pertenece a otro operador.",
            }, 403);
          }

          // 6. Un dispositivo revocado nunca se autoriza automáticamente.
          if (existente.revoked_at !== null) {
            return respuesta({
              success: false,
              status: "revoked",
              message:
                "El acceso de este dispositivo fue revocado.",
            });
          }

          // 7. Permitir que la cuenta autorizada recupere
          // un dispositivo pendiente de aprobación.
          if (
            userId === CUENTA_AUTORIZADA &&
            !existente.is_approved
          ) {
            const { data: recuperado, error: recuperacionError } =
              await admin
                .from("access_devices")
                .update({
                  is_approved: true,
                  last_used_at: new Date().toISOString(),
                })
                .eq("id", existente.id)
                .is("revoked_at", null)
                .select(columnas)
                .single();

            if (recuperacionError) {
              throw recuperacionError;
            }

            return respuesta({
              success: true,
              status: "approved",
              message: "Dispositivo autorizado.",
              device: recuperado,
            });
          }

          // 8. Los demás administradores deben esperar.
          if (!existente.is_approved) {
            return respuesta({
              success: false,
              status: "pending",
              message:
                "Tu solicitud todavía está pendiente de aprobación.",
            });
          }

          // 9. Actualizar el último uso del dispositivo aprobado.
          const { error: actualizacionError } = await admin
            .from("access_devices")
            .update({
              last_used_at: new Date().toISOString(),
            })
            .eq("id", existente.id);

          if (actualizacionError) {
            throw actualizacionError;
          }

          return respuesta({
            success: true,
            status: "approved",
            message: "Dispositivo autorizado.",
          });
        }

        // =====================================================
        // GESTIÓN EXCLUSIVA DE LA CUENTA AUTORIZADA
        // =====================================================

        if (userId !== CUENTA_AUTORIZADA) {
          return respuesta({
            error: "No tienes permiso para gestionar dispositivos.",
          }, 403);
        }

        // =====================================================
        // LISTAR DISPOSITIVOS
        // =====================================================

        if (action === "list") {
          const { data, error } = await admin
            .from("access_devices")
            .select(columnas)
            .order("created_at", { ascending: false });

          if (error) {
            throw error;
          }

          return respuesta({
            success: true,
            devices: data ?? [],
          });
        }

        // =====================================================
        // VALIDAR IDENTIFICADOR PARA LAS DEMÁS ACCIONES
        // =====================================================

        const id = body.id;

        if (
          typeof id !== "string" ||
          !formatoUUID.test(id)
        ) {
          return respuesta({
            error: "Identificador de dispositivo inválido.",
          }, 400);
        }

        // =====================================================
        // APROBAR UNA SOLICITUD
        // =====================================================

        if (action === "approve") {
          const { data, error } = await admin
            .from("access_devices")
            .update({
              is_approved: true,
            })
            .eq("id", id)
            .eq("is_approved", false)
            .is("revoked_at", null)
            .select(columnas)
            .maybeSingle();

          if (error) {
            throw error;
          }

          if (!data) {
            return respuesta({
              error:
                "La solicitud no existe o ya no puede aprobarse.",
            }, 404);
          }

          return respuesta({
            success: true,
            message: "Dispositivo aprobado correctamente.",
            device: data,
          });
        }

        // =====================================================
        // RECHAZAR UNA SOLICITUD
        // =====================================================

        if (action === "reject") {
          const { data, error } = await admin
            .from("access_devices")
            .update({
              is_approved: false,
              revoked_at: new Date().toISOString(),
            })
            .eq("id", id)
            .eq("is_approved", false)
            .is("revoked_at", null)
            .select(columnas)
            .maybeSingle();

          if (error) {
            throw error;
          }

          if (!data) {
            return respuesta({
              error:
                "La solicitud no existe o ya fue gestionada.",
            }, 404);
          }

          return respuesta({
            success: true,
            message: "Solicitud rechazada.",
            device: data,
          });
        }

        // =====================================================
        // REVOCAR UN DISPOSITIVO APROBADO
        // =====================================================

        if (action === "revoke") {
          const { data, error } = await admin
            .from("access_devices")
            .update({
              is_approved: false,
              revoked_at: new Date().toISOString(),
            })
            .eq("id", id)
            .eq("is_approved", true)
            .is("revoked_at", null)
            .select(columnas)
            .maybeSingle();

          if (error) {
            throw error;
          }

          if (!data) {
            return respuesta({
              error:
                "El dispositivo no existe o ya no está aprobado.",
            }, 404);
          }

          return respuesta({
            success: true,
            message: "Acceso revocado correctamente.",
            device: data,
          });
        }

        // =====================================================
        // ACCIÓN NO RECONOCIDA
        // =====================================================

        return respuesta({
          error: "Acción no reconocida.",
        }, 400);

      } catch (error) {
        console.error("Error en manage-devices:", error);

        return respuesta({
          error:
            "Ocurrió un error interno al gestionar los dispositivos.",
        }, 500);
      }
    },
  ),
};


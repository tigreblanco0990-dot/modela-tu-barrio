import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@^9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respuesta(datos: object, status = 200) {
  return Response.json(datos, {
    status,
    headers: corsHeaders,
  });
}

function escaparHTML(texto: string): string {
  return texto.replace(/[&<>"']/g, (caracter) => {
    const entidades: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entidades[caracter];
  });
}

async function calcularHash(token: string): Promise<string> {
  const datos = new TextEncoder().encode(token);
  const resultado = await crypto.subtle.digest("SHA-256", datos);

  return Array.from(new Uint8Array(resultado))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return respuesta({ error: "Método no permitido" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      throw new Error("Falta la configuración de Supabase");
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { qrToken, qrImage } = await req.json();

    if (
      typeof qrToken !== "string" ||
      qrToken.length !== 64 ||
      typeof qrImage !== "string" ||
      !qrImage.startsWith("data:image/png;base64,") ||
      qrImage.length > 500000
    ) {
      return respuesta({ error: "Datos del QR no válidos" }, 400);
    }

    // Comprobar que el QR pertenece a una inscripción activa.
    const hash = await calcularHash(qrToken);

    const { data: asistente, error: consultaError } =
      await supabaseAdmin
        .from("attendees")
        .select("full_name, email")
        .eq("qr_token_hash", hash)
        .eq("is_active", true)
        .maybeSingle();

    if (consultaError) {
      console.error("Error consultando inscripción:", consultaError);
      return respuesta({ error: "Error verificando inscripción" }, 500);
    }

    if (!asistente) {
      return respuesta({ error: "Inscripción no válida" }, 403);
    }

    // Leer las credenciales SMTP configuradas en Supabase.
    const host = Deno.env.get("SMTP_HOST");
    const port = Number(Deno.env.get("SMTP_PORT"));
    const usuario = Deno.env.get("SMTP_USER");
    const password = Deno.env.get("SMTP_PASS");
    const remitente = Deno.env.get("SMTP_FROM");

    if (!host || !port || !usuario || !password || !remitente) {
      throw new Error("Falta configurar el correo SMTP");
    }

    const transport = nodemailer.createTransport({
      host,
      port,
      secure: true,
      auth: {
        user: usuario,
        pass: password,
      },
    });

    // Cargar el logo oficial ubicado junto a este archivo.
    const logo = await Deno.readFile(
      new URL("./logo.png", import.meta.url),
    );

    const imagenBase64 = qrImage.split(",")[1];
    const nombre = escaparHTML(asistente.full_name);

    await transport.sendMail({
      from: `"Fundación Dreams Lab | Modela Tu Barrio" <${remitente}>`,
      to: asistente.email,
      subject: "Inscripción confirmada | Modela Tu Barrio",

      text:
        `Hola ${asistente.full_name}.\n\n` +
        "Tu inscripción a Modela Tu Barrio fue confirmada correctamente.\n" +
        "Adjuntamos tu código QR personal. Consérvalo y preséntalo al ingresar al evento.\n\n" +
        "Fundación Dreams Lab\nEquipo organizador de Modela Tu Barrio",

      html: `
        <!DOCTYPE html>
        <html lang="es">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Inscripción confirmada - Modela Tu Barrio</title>
          </head>

          <body style="margin:0; padding:0; background-color:#f4f4f4; font-family:Arial, Helvetica, sans-serif; color:#333333;">

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f4; padding:28px 12px;">
              <tr>
                <td align="center">

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden;">

                    <!-- ENCABEZADO -->
                    <tr>
                      <td align="center" style="padding:28px 24px 22px; background-color:#fff8f4; border-bottom:4px solid #ec4e2c;">

                        <img
                          src="cid:logo-fundacion-dreams-lab"
                          alt="Fundación Dreams Lab"
                          width="300"
                          style="display:block; width:100%; max-width:300px; height:auto; border:0;"
                        >

                        <div style="margin-top:20px; color:#ec4e2c; font-size:13px; font-weight:bold; letter-spacing:3px;">
                          MODELA TU BARRIO
                        </div>

                        <div style="margin-top:7px; color:#777777; font-size:11px; font-weight:bold; letter-spacing:2px;">
                          CONFIRMACIÓN DE INSCRIPCIÓN
                        </div>

                      </td>
                    </tr>

                    <!-- MENSAJE -->
                    <tr>
                      <td style="padding:34px 30px 12px;">

                        <h1 style="margin:0 0 18px; color:#292929; font-size:25px; line-height:1.3;">
                          ¡Tu inscripción está confirmada!
                        </h1>

                        <p style="margin:0 0 14px; color:#444444; font-size:16px; line-height:1.7;">
                          Hola, <strong>${nombre}</strong>.
                        </p>

                        <p style="margin:0 0 22px; color:#555555; font-size:15px; line-height:1.7;">
                          Tu inscripción a <strong>Modela Tu Barrio</strong> se completó correctamente. Nos alegra contar con tu participación.
                        </p>

                      </td>
                    </tr>

                    <!-- CÓDIGO QR -->
                    <tr>
                      <td align="center" style="padding:8px 30px 26px;">

                        <div style="margin-bottom:14px; color:#333333; font-size:15px; font-weight:bold;">
                          Este es tu código QR personal
                        </div>

                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #f2d4c8; border-radius:10px;">
                          <tr>
                            <td align="center" style="padding:16px;">

                              <img
                                src="cid:qr-modela-tu-barrio"
                                alt="Código QR de inscripción"
                                width="240"
                                height="240"
                                style="display:block; width:240px; max-width:100%; height:auto; border:0;"
                              >

                            </td>
                          </tr>
                        </table>

                        <p style="margin:18px 0 0; color:#666666; font-size:13px; line-height:1.6;">
                          Conserva este correo y presenta tu código QR al momento de ingresar al evento.
                        </p>

                      </td>
                    </tr>

                    <!-- PIE -->
                    <tr>
                      <td style="padding:22px 30px 28px; background-color:#fff8f4; border-top:1px solid #f3e1d9;">

                        <p style="margin:0 0 5px; color:#ec4e2c; font-size:14px; font-weight:bold;">
                          Fundación Dreams Lab
                        </p>

                        <p style="margin:0; color:#666666; font-size:13px; line-height:1.6;">
                          Equipo organizador<br>
                          Modela Tu Barrio
                        </p>

                      </td>
                    </tr>

                  </table>

                  <p style="margin:16px 0 0; color:#999999; font-size:11px; line-height:1.5; text-align:center;">
                    Este es un mensaje automático de confirmación de inscripción.
                  </p>

                </td>
              </tr>
            </table>

          </body>
        </html>
      `,

      attachments: [
        {
          filename: "Logo_Fundacion_Dreams_Lab.png",
          content: logo,
          contentType: "image/png",
          cid: "logo-fundacion-dreams-lab",
          contentDisposition: "inline",
        },
        {
          filename: "QR_Modela_Tu_Barrio.png",
          content: imagenBase64,
          encoding: "base64",
          contentType: "image/png",
          cid: "qr-modela-tu-barrio",
          contentDisposition: "inline",
        },
      ],
    });

    console.log("Correo enviado correctamente:", asistente.email);

    return respuesta({ success: true });

  } catch (error) {
    console.error("Error al enviar correo:", error);

    return respuesta(
      { error: "No se pudo enviar el correo de confirmación" },
      500,
    );
  }
});
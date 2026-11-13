
import { createClient } from 'npm:@supabase/supabase-js@2'

const MAIN_ADMIN = 'd4b997a6-2267-47f0-b8d9-fbcb4fc68b9d'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return response({ error: 'Método no permitido.' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return response({ error: 'Faltan variables de configuración.' }, 500)
    }

    const authorization = req.headers.get('Authorization')

    if (!authorization?.startsWith('Bearer ')) {
      return response({ error: 'Debes iniciar sesión.' }, 401)
    }

    const token = authorization.slice(7)

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    const {
      data: { user: caller },
      error: authError,
    } = await authClient.auth.getUser(token)

    if (authError || !caller) {
      return response({ error: 'La sesión no es válida.' }, 401)
    }

    if (caller.id !== MAIN_ADMIN) {
      return response({ error: 'No tienes autorización.' }, 403)
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    const body = await req.json()
    const deviceId = body.device_id

    if (typeof deviceId !== 'string' || deviceId.length < 10) {
      return response({ error: 'Dispositivo no válido.' }, 400)
    }

    const { data: device, error: deviceError } = await admin
      .from('access_devices')
      .select('id')
      .eq('user_id', MAIN_ADMIN)
      .eq('device_id', deviceId)
      .eq('is_approved', true)
      .is('revoked_at', null)
      .maybeSingle()

    if (deviceError || !device) {
      return response({ error: 'Dispositivo no autorizado.' }, 403)
    }

    if (body.action === 'list') {
      const { data: admins, error } = await admin
        .from('event_admins')
        .select('user_id, created_at')
        .order('created_at', { ascending: true })

      if (error) {
        return response({ error: 'No se pudieron consultar los usuarios.' }, 500)
      }

      const users = await Promise.all(
        (admins ?? []).map(async item => {
          const { data, error: userError } =
            await admin.auth.admin.getUserById(item.user_id)

          return {
            user_id: item.user_id,
            email: userError ? 'Correo no disponible' : data.user?.email ?? 'Sin correo',
            created_at: item.created_at,
            is_main: item.user_id === MAIN_ADMIN,
          }
        }),
      )

      return response({ success: true, users })
    }

    if (body.action === 'delete') {
      const userId = body.user_id

      if (typeof userId !== 'string' || userId.length < 10) {
        return response({ error: 'Usuario no válido.' }, 400)
      }

      if (userId === MAIN_ADMIN) {
        return response({ error: 'La cuenta principal está protegida.' }, 403)
      }

      const { data: target, error: targetError } = await admin
        .from('event_admins')
        .select('user_id, created_at')
        .eq('user_id', userId)
        .maybeSingle()

      if (targetError || !target) {
        return response({ error: 'El administrador no existe.' }, 404)
      }

      const { data: devices, error: devicesError } = await admin
        .from('access_devices')
        .select('*')
        .eq('user_id', userId)

      if (devicesError) {
        return response({ error: 'No se pudieron consultar sus dispositivos.' }, 500)
      }

      const { error: deleteDevicesError } = await admin
        .from('access_devices')
        .delete()
        .eq('user_id', userId)

      if (deleteDevicesError) {
        return response({ error: deleteDevicesError.message }, 500)
      }

      const { error: deleteAdminError } = await admin
        .from('event_admins')
        .delete()
        .eq('user_id', userId)

      if (deleteAdminError) {
        if (devices?.length) {
          await admin.from('access_devices').insert(devices)
        }

        return response({ error: deleteAdminError.message }, 500)
      }

      const { error: deleteAuthError } =
        await admin.auth.admin.deleteUser(userId)

      if (deleteAuthError) {
        const { error: restoreAdminError } = await admin
          .from('event_admins')
          .insert([target])

        let restoreDevicesError = null

        if (devices?.length) {
          const result = await admin
            .from('access_devices')
            .insert(devices)

          restoreDevicesError = result.error
        }

        return response({
          error: deleteAuthError.message,
          restored: !restoreAdminError && !restoreDevicesError,
        }, 500)
      }

      return response({
        success: true,
        message: 'La cuenta administrativa fue eliminada correctamente.',
      })
    }

    return response({ error: 'Acción no reconocida.' }, 400)
  } catch (error) {
    console.error('manage-users:', error)

    return response({
      error: error instanceof Error ? error.message : 'Error interno.',
    }, 500)
  }
})

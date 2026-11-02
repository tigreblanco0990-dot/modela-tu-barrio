
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type CheckInResult = {
  success: boolean
  outcome: string
  message: string
  attendee_name: string | null
  entry_time: string | null
}

function obtenerDeviceId(): string {
  const clave = 'mtb_device_id'
  let id = localStorage.getItem(clave)

  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(clave, id)
  }

  return id
}

function tituloResultado(outcome: string): string {
  const titulos: Record<string, string> = {
    authorized: 'Entrada aceptada',
    already_used: 'QR ya utilizado',
    revoked: 'Inscripción desactivada',
    invalid: 'QR no válido',
    pending_device: 'Dispositivo pendiente de aprobación',
    device_revoked: 'Dispositivo revocado',
  }

  return titulos[outcome] ?? 'Resultado de la validación'
}

export default function AdminScanner({
  onVolver,
}: {
  onVolver: () => void
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [deviceId] = useState(() => obtenerDeviceId())

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [cargando, setCargando] = useState(true)
  const [escaneando, setEscaneando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [resultado, setResultado] = useState<CheckInResult | null>(null)

  const procesando = useRef(false)
  const ultimoToken = useRef('')
  const ultimoEscaneo = useRef(0)

  useEffect(() => {
    let activo = true

    supabase.auth.getSession().then(({ data }) => {
      if (activo) {
        setSession(data.session)
        setCargando(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nuevaSesion) => {
        setSession(nuevaSesion)
      },
    )

    return () => {
      activo = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session || !escaneando) return

    let cancelado = false

    const scanner = new Html5QrcodeScanner(
      'qr-reader',
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1,
      },
      false,
    )

    const procesarQR = async (token: string) => {
      const ahora = Date.now()

      if (procesando.current || cancelado) return

      if (
        token === ultimoToken.current &&
        ahora - ultimoEscaneo.current < 2000
      ) {
        return
      }

      procesando.current = true
      ultimoToken.current = token
      ultimoEscaneo.current = ahora

      setMensaje('Verificando el código QR...')
      setResultado(null)

      try {
        const { data, error } = await supabase.functions.invoke(
          'validate-entry',
          {
            body: {
              token,
              device_id: deviceId,
              device_label: `MTB - ${navigator.userAgent.includes('Android') ? 'Android' : navigator.userAgent.includes('iPhone') ? 'iPhone' : 'Otro dispositivo'}`,
            },
          },
        )

        if (error) {
  const respuestaError = (error as { context?: Response }).context

  if (respuestaError) {
    const detalle = await respuestaError
      .clone()
      .json()
      .catch(() => null)

    if (detalle && typeof detalle.outcome === 'string') {
      setResultado({
        success: detalle.success === true,
        outcome: detalle.outcome,
        message: detalle.message ?? 'Resultado de la validación.',
        attendee_name: detalle.attendee_name ?? null,
        entry_time: detalle.entry_time ?? null,
      })

      setMensaje('')
      return
    }

    if (detalle && typeof detalle.error === 'string') {
      throw new Error(detalle.error)
    }
  }

  throw new Error(
    'No se pudo contactar con el servidor. Comprueba tu conexión y tu sesión.',
  )
}

        if (!data) {
          throw new Error('El servidor no devolvió ningún resultado.')
        }

        if (data.error) {
          throw new Error(data.error)
        }

        setResultado(data as CheckInResult)
        setMensaje('')
      } catch (error) {
        setMensaje(
          error instanceof Error
            ? error.message
            : 'Ocurrió un error al validar el QR.',
        )
      } finally {
        procesando.current = false
      }
    }

    scanner.render(
      (textoLeido) => {
        void procesarQR(textoLeido)
      },
      () => {
        // Se ignoran los errores normales mientras se busca un QR.
      },
    )

    return () => {
      cancelado = true
      void scanner.clear().catch(() => {})
    }
  }, [session, escaneando, deviceId])

  async function iniciarSesion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMensaje('')
    setCargando(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) throw error

      setPassword('')
      setMensaje('Sesión iniciada correctamente.')
    } catch (error) {
      setMensaje(
        error instanceof Error
          ? error.message
          : 'No se pudo iniciar sesión.',
      )
    } finally {
      setCargando(false)
    }
  }

  async function cerrarSesion() {
    setEscaneando(false)
    setResultado(null)
    setMensaje('')

    const { error } = await supabase.auth.signOut()

    if (error) {
      setMensaje('No se pudo cerrar la sesión. Inténtalo de nuevo.')
    }
  }

  function activarEscaner() {
    procesando.current = false
    ultimoToken.current = ''
    ultimoEscaneo.current = 0
    setResultado(null)
    setMensaje('')
    setEscaneando(true)
  }

  function detenerEscaner() {
    setEscaneando(false)
    setResultado(null)
    setMensaje('Escáner detenido.')
  }

  if (cargando) {
    return (
      <main className="admin-page">
        <p>Comprobando sesión...</p>
      </main>
    )
  }

  return (
    <main className="admin-page">
      <section className="admin-card">
        <button
          type="button"
          className="admin-back"
          onClick={onVolver}
        >
          ← Volver al evento
        </button>

        <p className="admin-eyebrow">MODELA TU BARRIO</p>

        <h1>Control de entradas</h1>

        <p className="admin-description">
          Panel privado para verificar los códigos QR de los participantes.
        </p>

        {!session ? (
          <form className="admin-form" onSubmit={iniciarSesion}>
            <h2>Iniciar sesión</h2>

            <label htmlFor="admin-email">
              Correo del administrador
            </label>

            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <label htmlFor="admin-password">
              Contraseña
            </label>

            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <button type="submit" disabled={cargando}>
              Entrar al panel
            </button>
          </form>
        ) : (
          <div className="admin-scanner-area">
            <p className="admin-session">
              Sesión iniciada. El servidor verificará tus permisos.
            </p>

            <p className="admin-description">
              Identificador de este dispositivo:
            </p>

            <code className="admin-device-id">
              {deviceId}
            </code>

            {!escaneando ? (
              <button
                type="button"
                className="admin-primary"
                onClick={activarEscaner}
              >
                Activar escáner QR
              </button>
            ) : (
              <div className="admin-camera">
                <p>
                  Apunta la cámara al código QR del participante.
                </p>

                <div id="qr-reader" />

                <button
                  type="button"
                  className="admin-secondary"
                  onClick={detenerEscaner}
                >
                  Detener escáner
                </button>
              </div>
            )}

            {resultado && (
              <section
                className={
                  resultado.outcome === 'authorized'
                    ? 'admin-result admin-result-success'
                    : 'admin-result admin-result-error'
                }
                aria-live="polite"
              >
                <h2>
                  {tituloResultado(resultado.outcome)}
                </h2>

                <p>{resultado.message}</p>

                {resultado.attendee_name && (
                  <p>
                    <strong>Participante:</strong>{' '}
                    {resultado.attendee_name}
                  </p>
                )}

                {resultado.entry_time && (
                  <p>
                    <strong>Hora de entrada:</strong>{' '}
                    {new Date(resultado.entry_time).toLocaleString('es-DO', {
                      dateStyle: 'short',
                      timeStyle: 'medium',
                    })}
                  </p>
                )}

                {escaneando && (
                  <p>
                    El escáner está preparado para el siguiente participante.
                  </p>
                )}
              </section>
            )}

            {mensaje && (
              <p className="admin-message" role="status">
                {mensaje}
              </p>
            )}

            <button
              type="button"
              className="admin-secondary"
              onClick={cerrarSesion}
            >
              Cerrar sesión
            </button>
          </div>
        )}

        {!session && mensaje && (
          <p className="admin-message" role="status">
            {mensaje}
          </p>
        )}
      </section>
    </main>
  )
}

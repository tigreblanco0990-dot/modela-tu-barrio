
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'
import type { Session } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'

type CheckInResult = {
  success: boolean
  outcome: string
  message: string
  attendee_name: string | null
  entry_time: string | null
}

type Asistente = {
  full_name: string
  organization: string | null
  checked_in_at: string
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

function mostrarFecha(fecha: string): string {
  return new Date(fecha).toLocaleDateString('es-DO', {
    timeZone: 'America/Santo_Domingo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function mostrarHora(fecha: string): string {
  return new Date(fecha).toLocaleTimeString('es-DO', {
    timeZone: 'America/Santo_Domingo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
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

  // Estados del panel de asistentes
  const [vista, setVista] = useState<'scanner' | 'asistentes'>('scanner')
  const [asistentes, setAsistentes] = useState<Asistente[]>([])
  const [cargandoAsistentes, setCargandoAsistentes] = useState(false)
  const [errorAsistentes, setErrorAsistentes] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [actualizacionAsistentes, setActualizacionAsistentes] = useState(0)

  const procesando = useRef(false)
  const ultimoToken = useRef('')
  const ultimoEscaneo = useRef(0)

  // Comprobar sesión
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

  // Cargar asistentes que realmente entraron al evento
  useEffect(() => {
    if (!session) {
      setAsistentes([])
      return
    }

    let activo = true

    async function cargarAsistentes() {
      setCargandoAsistentes(true)
      setErrorAsistentes('')

      try {
        // Buscar el evento
        const { data: evento, error: errorEvento } = await supabase
          .from('events')
          .select('id')
          .eq('name', 'Modela tu barrio')
          .limit(1)
          .maybeSingle()

        if (errorEvento) throw errorEvento

        if (!evento) {
          throw new Error('No se encontró el evento Modela tu barrio.')
        }

        // Obtener exclusivamente participantes con entrada confirmada
        const { data, error } = await supabase
          .from('attendees')
          .select('full_name, organization, checked_in_at')
          .eq('event_id', evento.id)
          .not('checked_in_at', 'is', null)
          .order('checked_in_at', { ascending: true })

        if (error) throw error

        if (activo) {
          setAsistentes((data ?? []) as Asistente[])
        }
      } catch (error) {
        if (activo) {
          setErrorAsistentes(
            error instanceof Error
              ? error.message
              : 'No se pudieron cargar los asistentes.',
          )
        }
      } finally {
        if (activo) setCargandoAsistentes(false)
      }
    }

    void cargarAsistentes()

    return () => {
      activo = false
    }
  }, [session, actualizacionAsistentes])

  // Escáner QR
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

              if (detalle.outcome === 'authorized') {
                setActualizacionAsistentes(v => v + 1)
              }

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

        const resultadoValidacion = data as CheckInResult

        setResultado(resultadoValidacion)

        if (resultadoValidacion.outcome === 'authorized') {
          setActualizacionAsistentes(v => v + 1)
        }

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
    setVista('scanner')

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

  function mostrarAsistentes() {
    setEscaneando(false)
    setVista('asistentes')
    setBusqueda('')
    setMensaje('')
    setActualizacionAsistentes(v => v + 1)
  }

  function exportarExcel() {
    if (asistentes.length === 0) {
      setErrorAsistentes('No hay asistentes para exportar.')
      return
    }

    const filas = asistentes.map((asistente, indice) => [
      indice + 1,
      asistente.full_name,
      asistente.organization || 'No especificada',
      mostrarFecha(asistente.checked_in_at),
      mostrarHora(asistente.checked_in_at),
    ])

    const contenido = [
      ['Posición', 'Nombre completo', 'Institución', 'Fecha de entrada', 'Hora de entrada'],
      ...filas,
    ]

    const hoja = XLSX.utils.aoa_to_sheet(contenido)

    hoja['!cols'] = [
      { wch: 12 },
      { wch: 32 },
      { wch: 30 },
      { wch: 20 },
      { wch: 20 },
    ]

    const libro = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(
      libro,
      hoja,
      'Asistentes',
    )

    XLSX.writeFile(
      libro,
      'Asistentes_Modela_Tu_Barrio.xlsx',
    )
  }

  const asistentesFiltrados = asistentes.filter(asistente => {
    const texto = `${asistente.full_name} ${asistente.organization ?? ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()

    const consulta = busqueda
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()

    return texto.includes(consulta)
  })

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
          Panel privado para verificar los códigos QR y consultar la asistencia.
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

            <div className="admin-tabs">
              <button
                type="button"
                className={vista === 'scanner' ? 'admin-tab active' : 'admin-tab'}
                onClick={() => {
                  setEscaneando(false)
                  setVista('scanner')
                  setMensaje('')
                }}
              >
                Escáner QR
              </button>

              <button
                type="button"
                className={vista === 'asistentes' ? 'admin-tab active' : 'admin-tab'}
                onClick={mostrarAsistentes}
              >
                Asistentes
              </button>
            </div>

            {vista === 'scanner' ? (
              <>
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
                      <div className="admin-entry-datetime">
                        <p>
                          <strong>Fecha de entrada:</strong>{' '}
                          {mostrarFecha(resultado.entry_time)}
                        </p>

                        <p>
                          <strong>Hora de entrada:</strong>{' '}
                          {mostrarHora(resultado.entry_time)}
                        </p>
                      </div>
                    )}

                    {escaneando && (
                      <p>
                        El escáner está preparado para el siguiente participante.
                      </p>
                    )}
                  </section>
                )}
              </>
            ) : (
              <section className="admin-attendance">
                <div className="admin-attendance-heading">
                  <div>
                    <h2>Registro de asistentes</h2>
                    <p>
                      Participantes que tienen su entrada confirmada.
                    </p>
                  </div>

                  <div className="admin-attendance-count">
                    <strong>{asistentes.length}</strong>
                    <span>Asistentes</span>
                  </div>
                </div>

                <div className="admin-attendance-actions">
                  <input
                    type="search"
                    placeholder="Buscar por nombre o institución..."
                    value={busqueda}
                    onChange={e => setBusqueda(e.target.value)}
                    aria-label="Buscar asistentes"
                  />

                  <button
                    type="button"
                    className="admin-secondary"
                    onClick={() => setActualizacionAsistentes(v => v + 1)}
                    disabled={cargandoAsistentes}
                  >
                    {cargandoAsistentes ? 'Actualizando...' : 'Actualizar'}
                  </button>
                </div>

                {errorAsistentes && (
                  <p className="admin-message" role="alert">
                    {errorAsistentes}
                  </p>
                )}

                {cargandoAsistentes ? (
                  <p className="admin-attendance-empty">
                    Cargando asistentes...
                  </p>
                ) : asistentes.length === 0 ? (
                  <p className="admin-attendance-empty">
                    Todavía no hay entradas confirmadas.
                  </p>
                ) : asistentesFiltrados.length === 0 ? (
                  <p className="admin-attendance-empty">
                    No se encontraron coincidencias.
                  </p>
                ) : (
                  <div className="admin-attendance-list">
                    {asistentesFiltrados.map(asistente => {
                      const posicion = asistentes.indexOf(asistente) + 1

                      return (
                        <article
                          className="admin-attendee"
                          key={`${asistente.full_name}-${asistente.checked_in_at}`}
                        >
                          <span className="admin-attendee-position">
                            {String(posicion).padStart(2, '0')}
                          </span>

                          <div className="admin-attendee-info">
                            <strong>{asistente.full_name}</strong>
                            <span>
                              {asistente.organization || 'Institución no especificada'}
                            </span>
                          </div>

                          <div className="admin-attendee-time">
                            <strong>{mostrarHora(asistente.checked_in_at)}</strong>
                            <span>{mostrarFecha(asistente.checked_in_at)}</span>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )}

                <button
                  type="button"
                  className="admin-primary admin-export"
                  onClick={exportarExcel}
                  disabled={cargandoAsistentes || asistentes.length === 0}
                >
                  ↓ Descargar lista en Excel
                </button>

                <p className="admin-attendance-note">
                  El orden corresponde a la hora de entrada registrada por el escáner QR.
                </p>
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



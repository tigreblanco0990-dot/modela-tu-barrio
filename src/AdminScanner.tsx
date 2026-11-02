
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

  const [vista, setVista] = useState<'scanner' | 'asistentes'>('scanner')
  const [asistentes, setAsistentes] = useState<Asistente[]>([])
  const [cargandoAsistentes, setCargandoAsistentes] = useState(false)
  const [errorAsistentes, setErrorAsistentes] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [actualizacionAsistentes, setActualizacionAsistentes] = useState(0)

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
    if (!session) {
      setAsistentes([])
      return
    }

    let activo = true

    async function cargarAsistentes() {
      setCargandoAsistentes(true)
      setErrorAsistentes('')

      try {
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
      textoLeido => {
        void procesarQR(textoLeido)
      },
      () => {},
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
      setErrorAsistentes('No hay invitados para exportar.')
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
      'Registro de asistencia',
    )

    XLSX.writeFile(
      libro,
      'Registro_de_Asistencia_Modela_Tu_Barrio.xlsx',
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
      <main className="admin-page admin-loading">
        <div className="admin-loading-card">
          <span className="admin-spinner" />
          <p>Comprobando sesión...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="admin-page">
      <div className="admin-shell">
        <button
          type="button"
          className="admin-back"
          onClick={onVolver}
        >
          <span>←</span> Volver al evento
        </button>

        {!session ? (
          <section className="admin-login-card">
            <div className="admin-login-brand">
              <img
                src="/logo-modela-tu-barrio.png"
                alt="Modela tu barrio"
                className="admin-logo admin-login-logo"
              />
              <span className="admin-brand-caption">
                CENTRO DE CONTROL
              </span>
            </div>

            <div className="admin-login-heading">
              <span className="admin-kicker">ACCESO ADMINISTRATIVO</span>
              <h1>Bienvenido de nuevo.</h1>
              <p>
                Accede al centro de control de Modela tu barrio
                para gestionar el ingreso y la asistencia del evento.
              </p>
            </div>

            <form className="admin-form" onSubmit={iniciarSesion}>
              <div className="admin-field">
                <label htmlFor="admin-email">Correo electrónico</label>
                <input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  placeholder="Ingresa tu correo"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="admin-field">
                <label htmlFor="admin-password">Contraseña</label>
                <input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Ingresa tu contraseña"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className="admin-primary admin-login-submit"
                disabled={cargando}
              >
                {cargando ? 'Ingresando...' : 'Ingresar al panel'}
                {!cargando && <span>↗</span>}
              </button>
            </form>

            {mensaje && (
              <p className="admin-message" role="status">
                {mensaje}
              </p>
            )}

            <div className="admin-login-footer">
              <span className="admin-security-dot" />
              Acceso exclusivo para personal autorizado.
            </div>
          </section>
        ) : (
          <>
            <header className="admin-header">
              <div className="admin-header-brand">
                <img
                  src="/logo-modela-tu-barrio.png"
                  alt="Modela tu barrio"
                  className="admin-logo"
                />
                <div>
                  <span className="admin-brand-caption">
                    MODELA TU BARRIO
                  </span>
                  <span className="admin-header-subtitle">
                    CENTRO DE CONTROL
                  </span>
                </div>
              </div>

              <div className="admin-header-status">
                <span className="admin-status-dot" />
                Panel privado
              </div>
            </header>

            <section className="admin-dashboard">
              <div className="admin-welcome">
                <span className="admin-kicker">
                  GESTIÓN DEL EVENTO
                </span>
                <h1>Panel administrativo</h1>
                <p>
                  Gestiona el acceso y consulta la actividad
                  de Modela tu barrio.
                </p>
              </div>

              <div className="admin-tabs">
                <button
                  type="button"
                  className={
                    vista === 'scanner'
                      ? 'admin-tab active'
                      : 'admin-tab'
                  }
                  onClick={() => {
                    setEscaneando(false)
                    setVista('scanner')
                    setMensaje('')
                    setResultado(null)
                  }}
                >
                  <span className="admin-tab-icon">⌗</span>
                  Control de acceso
                </button>

                <button
                  type="button"
                  className={
                    vista === 'asistentes'
                      ? 'admin-tab active'
                      : 'admin-tab'
                  }
                  onClick={mostrarAsistentes}
                >
                  <span className="admin-tab-icon">♧</span>
                  Registro de asistencia
                </button>
              </div>

              {vista === 'scanner' ? (
                <section className="admin-workspace">
                  <div className="admin-section-heading">
                    <div>
                      <span className="admin-kicker">VALIDACIÓN DE ENTRADAS</span>
                      <h2>Control de acceso</h2>
                      <p>
                        Escanea el código QR de cada participante
                        para verificar su entrada.
                      </p>
                    </div>

                    <div className="admin-status-label">
                      <span className="admin-status-dot" />
                      Sistema disponible
                    </div>
                  </div>

                  <div className="admin-scanner-card">
                    {!escaneando ? (
                      <div className="admin-scanner-intro">
                        <div className="admin-scan-icon">
                          <span>⌗</span>
                        </div>
                        <h3>Listo para escanear</h3>
                        <p>
                          Activa la cámara para comenzar a validar
                          los códigos QR de los invitados.
                        </p>
                        <button
                          type="button"
                          className="admin-primary"
                          onClick={activarEscaner}
                        >
                          <span>⌗</span> Activar escáner QR
                        </button>
                      </div>
                    ) : (
                      <div className="admin-camera">
                        <div className="admin-camera-heading">
                          <div>
                            <h3>Escáner activo</h3>
                            <p>Apunta la cámara al código QR del participante.</p>
                          </div>
                          <span className="admin-live-indicator">
                            <span /> EN VIVO
                          </span>
                        </div>

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
                  </div>

                  <div className="admin-device-info">
                    <span className="admin-device-icon">⌘</span>
                    <div>
                      <strong>Identificador del dispositivo</strong>
                      <code>{deviceId}</code>
                    </div>
                  </div>

                  {resultado && (
                    <section
                      className={
                        resultado.outcome === 'authorized'
                          ? 'admin-result admin-result-success'
                          : 'admin-result admin-result-error'
                      }
                      aria-live="polite"
                    >
                      <div className="admin-result-symbol">
                        {resultado.outcome === 'authorized' ? '✓' : '!'}
                      </div>
                      <div className="admin-result-content">
                        <h2>{tituloResultado(resultado.outcome)}</h2>
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
                              <strong>Fecha:</strong>{' '}
                              {mostrarFecha(resultado.entry_time)}
                            </p>
                            <p>
                              <strong>Hora:</strong>{' '}
                              {mostrarHora(resultado.entry_time)}
                            </p>
                          </div>
                        )}

                        {escaneando && (
                          <p className="admin-result-hint">
                            El escáner está preparado para el siguiente participante.
                          </p>
                        )}
                      </div>
                    </section>
                  )}

                  {mensaje && (
                    <p className="admin-message" role="status">
                      {mensaje}
                    </p>
                  )}
                </section>
              ) : (
                <section className="admin-attendance">
                  <div className="admin-attendance-heading">
                    <div>
                      <span className="admin-kicker">CONTROL DE PARTICIPACIÓN</span>
                      <h2>Registro de asistencia</h2>
                      <p>
                        Invitados que tienen su entrada confirmada.
                      </p>
                    </div>

                    <div className="admin-attendance-count">
                      <strong>{asistentes.length}</strong>
                      <span>
                        {asistentes.length === 1 ? 'invitado' : 'invitados'}
                      </span>
                    </div>
                  </div>

                  <div className="admin-attendance-actions">
                    <div className="admin-search">
                      <span>⌕</span>
                      <input
                        type="search"
                        placeholder="Buscar por nombre o institución..."
                        value={busqueda}
                        onChange={e => setBusqueda(e.target.value)}
                        aria-label="Buscar invitados"
                      />
                    </div>

                    <button
                      type="button"
                      className="admin-secondary admin-refresh"
                      onClick={() => setActualizacionAsistentes(v => v + 1)}
                      disabled={cargandoAsistentes}
                    >
                      ↻ {cargandoAsistentes ? 'Actualizando...' : 'Actualizar'}
                    </button>
                  </div>

                  {errorAsistentes && (
                    <p className="admin-message" role="alert">
                      {errorAsistentes}
                    </p>
                  )}

                  {cargandoAsistentes ? (
                    <div className="admin-attendance-empty">
                      <span className="admin-spinner" />
                      <p>Cargando invitados...</p>
                    </div>
                  ) : asistentes.length === 0 ? (
                    <div className="admin-attendance-empty">
                      <span className="admin-empty-icon">♧</span>
                      <strong>Aún no hay entradas confirmadas</strong>
                      <p>Cuando se validen los primeros códigos QR, aparecerán aquí.</p>
                    </div>
                  ) : asistentesFiltrados.length === 0 ? (
                    <div className="admin-attendance-empty">
                      <strong>No encontramos coincidencias</strong>
                      <p>Prueba con otro nombre o institución.</p>
                    </div>
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

              <footer className="admin-dashboard-footer">
                <div>
                  <span className="admin-security-dot" />
                  Sesión administrativa activa
                </div>
                <button
                  type="button"
                  className="admin-logout"
                  onClick={cerrarSesion}
                >
                  Cerrar sesión <span>↗</span>
                </button>
              </footer>
            </section>
          </>
        )}
      </div>
    </main>
  )
}


import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'
import type { Session } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'

const CUENTA_AUTORIZADA =
  'd4b997a6-2267-47f0-b8d9-fbcb4fc68b9d'

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

type Dispositivo = {
  id: string
  user_id: string
  device_id: string
  device_label: string
  is_approved: boolean
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

type Vista = 'scanner' | 'asistentes' | 'dispositivos'

type EstadoDispositivo =
  | 'checking'
  | 'pending'
  | 'approved'
  | 'revoked'
  | 'unauthorized'
  | 'error'

type ResultadoAcceso = {
  estado: EstadoDispositivo
  mensaje: string
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

function obtenerEtiquetaDispositivo(): string {
  const navegador = navigator.userAgent

  if (navegador.includes('Android')) return 'MTB - Android'
  if (navegador.includes('iPhone')) return 'MTB - iPhone'
  if (navegador.includes('iPad')) return 'MTB - iPad'
  if (navegador.includes('Windows')) return 'MTB - Windows'
  if (navegador.includes('Mac')) return 'MTB - Mac'

  return 'MTB - Otro dispositivo'
}

// Consultar autorización del dispositivo en Supabase.
async function consultarAccesoDispositivo(
  deviceId: string,
): Promise<ResultadoAcceso> {
  try {
    const { data, error } = await supabase.functions.invoke(
      'manage-devices',
      {
        body: {
          action: 'register',
          device_id: deviceId,
          device_label: obtenerEtiquetaDispositivo(),
        },
      },
    )

    if (error) {
      const respuestaError = (
        error as { context?: Response }
      ).context

      const detalle = respuestaError
        ? await respuestaError.clone().json().catch(() => null)
        : null

      if (detalle?.status === 'unauthorized') {
        return {
          estado: 'unauthorized',
          mensaje:
            detalle.message ?? 'Tu cuenta no está autorizada.',
        }
      }

      if (detalle?.status === 'revoked') {
        return {
          estado: 'revoked',
          mensaje:
            detalle.message ?? 'El acceso de este dispositivo fue revocado.',
        }
      }

      return {
        estado: 'error',
        mensaje:
          detalle?.message ??
          detalle?.error ??
          'No se pudo comprobar la autorización. Comprueba tu conexión.',
      }
    }

    if (!data || typeof data.status !== 'string') {
      return {
        estado: 'error',
        mensaje: 'El servidor devolvió una respuesta no válida.',
      }
    }

    const estadosPermitidos: EstadoDispositivo[] = [
      'approved',
      'pending',
      'revoked',
      'unauthorized',
    ]

    if (!estadosPermitidos.includes(data.status as EstadoDispositivo)) {
      return {
        estado: 'error',
        mensaje: 'No se pudo determinar el estado del dispositivo.',
      }
    }

    return {
      estado: data.status as EstadoDispositivo,
      mensaje: data.message ?? 'Estado del dispositivo actualizado.',
    }
  } catch (error) {
    return {
      estado: 'error',
      mensaje:
        error instanceof Error
          ? error.message
          : 'Ocurrió un error al comprobar el dispositivo.',
    }
  }
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

  // Estado de autorización del dispositivo.
  const [deviceAccess, setDeviceAccess] =
    useState<EstadoDispositivo | null>(null)

  const [deviceAccessMessage, setDeviceAccessMessage] = useState('')
  const [comprobandoAcceso, setComprobandoAcceso] = useState(false)

  const [vista, setVista] = useState<Vista>('scanner')

  const [asistentes, setAsistentes] = useState<Asistente[]>([])
  const [cargandoAsistentes, setCargandoAsistentes] = useState(false)
  const [errorAsistentes, setErrorAsistentes] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [actualizacionAsistentes, setActualizacionAsistentes] = useState(0)

  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([])
  const [cargandoDispositivos, setCargandoDispositivos] = useState(false)
  const [errorDispositivos, setErrorDispositivos] = useState('')
  const [procesandoDispositivo, setProcesandoDispositivo] = useState('')
  const [avisoDispositivo, setAvisoDispositivo] = useState('')

  const procesando = useRef(false)
  const ultimoToken = useRef('')
  const ultimoEscaneo = useRef(0)

  const puedeGestionarDispositivos =
    session?.user.id === CUENTA_AUTORIZADA

  const solicitudesPendientes = dispositivos.filter(
    d => !d.is_approved && !d.revoked_at,
  )

  // =====================================================
  // COMPROBAR SESIÓN
  // =====================================================

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

        if (!nuevaSesion) {
          setDeviceAccess(null)
          setDeviceAccessMessage('')
        }
      },
    )

    return () => {
      activo = false
      listener.subscription.unsubscribe()
    }
  }, [])

  // =====================================================
  // COMPROBAR AUTORIZACIÓN DEL DISPOSITIVO
  // =====================================================

  useEffect(() => {
    if (!session) {
      setDeviceAccess(null)
      setDeviceAccessMessage('')
      return
    }

    let activo = true

    async function comprobar() {
      setDeviceAccess('checking')
      setDeviceAccessMessage(
        'Estamos verificando la autorización de este dispositivo.',
      )

      const resultadoAcceso =
        await consultarAccesoDispositivo(deviceId)

      if (!activo) return

      setDeviceAccess(resultadoAcceso.estado)
      setDeviceAccessMessage(resultadoAcceso.mensaje)
    }

    void comprobar()

    return () => {
      activo = false
    }
  }, [session?.user.id, deviceId])

  // Volver a comprobar manualmente la autorización.
  async function volverAComprobarAcceso() {
    setComprobandoAcceso(true)
    setDeviceAccess('checking')
    setDeviceAccessMessage('Comprobando autorización...')

    const resultadoAcceso =
      await consultarAccesoDispositivo(deviceId)

    setDeviceAccess(resultadoAcceso.estado)
    setDeviceAccessMessage(resultadoAcceso.mensaje)
    setComprobandoAcceso(false)
  }

  // =====================================================
  // CARGAR ASISTENTES
  // =====================================================

  useEffect(() => {
    if (!session || deviceAccess !== 'approved') {
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
  }, [session, deviceAccess, actualizacionAsistentes])

  // =====================================================
  // CARGAR DISPOSITIVOS Y ESCUCHAR SOLICITUDES NUEVAS
  // =====================================================

  useEffect(() => {
    if (
      !session ||
      deviceAccess !== 'approved' ||
      session.user.id !== CUENTA_AUTORIZADA
    ) {
      setDispositivos([])
      return
    }

    let activo = true

    async function cargarDispositivos() {
      try {
        const { data, error } = await supabase.functions.invoke(
          'manage-devices',
          {
            body: { action: 'list' },
          },
        )

        if (error) throw error
        if (data?.error) throw new Error(data.error)

        if (activo) {
          setDispositivos(data?.devices ?? [])
          setErrorDispositivos('')
        }
      } catch (error) {
        if (activo) {
          setErrorDispositivos(
            error instanceof Error
              ? error.message
              : 'No se pudieron cargar los dispositivos.',
          )
        }
      } finally {
        if (activo) setCargandoDispositivos(false)
      }
    }

    setCargandoDispositivos(true)
    void cargarDispositivos()

    const canal = supabase
      .channel('solicitudes-dispositivos-mtb')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'access_devices',
        },
        () => {
          if (activo) {
            setAvisoDispositivo(
              '¡Ha llegado una nueva solicitud de acceso!',
            )
            setCargandoDispositivos(true)
            void cargarDispositivos()
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'access_devices',
        },
        () => {
          if (activo) {
            void cargarDispositivos()
          }
        },
      )
      .subscribe()

    return () => {
      activo = false
      void supabase.removeChannel(canal)
    }
  }, [session, deviceAccess])

  // =====================================================
  // ESCÁNER QR
  // =====================================================

  useEffect(() => {
    if (
      !session ||
      deviceAccess !== 'approved' ||
      !escaneando
    ) {
      return
    }

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
              device_label: obtenerEtiquetaDispositivo(),
            },
          },
        )

        if (error) {
          const respuestaError = (
            error as { context?: Response }
          ).context

          if (respuestaError) {
            const detalle = await respuestaError
              .clone()
              .json()
              .catch(() => null)

            if (detalle && typeof detalle.outcome === 'string') {
              setResultado({
                success: detalle.success === true,
                outcome: detalle.outcome,
                message:
                  detalle.message ?? 'Resultado de la validación.',
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
  }, [session, deviceAccess, escaneando, deviceId])

  // =====================================================
  // INICIAR SESIÓN
  // =====================================================

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
      setMensaje('Sesión iniciada. Comprobando dispositivo...')
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

  // =====================================================
  // CERRAR SESIÓN
  // =====================================================

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

  // =====================================================
  // ACTIVAR Y DETENER ESCÁNER
  // =====================================================

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

  // =====================================================
  // MOSTRAR ASISTENTES
  // =====================================================

  function mostrarAsistentes() {
    setEscaneando(false)
    setVista('asistentes')
    setBusqueda('')
    setMensaje('')
    setActualizacionAsistentes(v => v + 1)
  }

  // =====================================================
  // ACTUALIZAR DISPOSITIVOS
  // =====================================================

  async function actualizarDispositivos() {
    setCargandoDispositivos(true)
    setErrorDispositivos('')
    setAvisoDispositivo('')

    try {
      const { data, error } = await supabase.functions.invoke(
        'manage-devices',
        {
          body: { action: 'list' },
        },
      )

      if (error) throw error
      if (data?.error) throw new Error(data.error)

      setDispositivos(data?.devices ?? [])
    } catch (error) {
      setErrorDispositivos(
        error instanceof Error
          ? error.message
          : 'No se pudieron actualizar los dispositivos.',
      )
    } finally {
      setCargandoDispositivos(false)
    }
  }

  // =====================================================
  // APROBAR, RECHAZAR O REVOCAR DISPOSITIVOS
  // =====================================================

  async function gestionarDispositivo(
    id: string,
    action: 'approve' | 'reject' | 'revoke',
  ) {
    const confirmaciones = {
      approve: '¿Deseas aprobar este dispositivo?',
      reject: '¿Deseas rechazar esta solicitud?',
      revoke: '¿Deseas revocar el acceso de este dispositivo?',
    }

    if (!window.confirm(confirmaciones[action])) return

    setProcesandoDispositivo(id)
    setErrorDispositivos('')
    setAvisoDispositivo('')

    try {
      const { data, error } = await supabase.functions.invoke(
        'manage-devices',
        {
          body: { action, id },
        },
      )

      if (error) throw error
      if (data?.error) throw new Error(data.error)

      if (!data?.success) {
        throw new Error('No se pudo completar la operación.')
      }

      setAvisoDispositivo(data.message)
      await actualizarDispositivos()
    } catch (error) {
      setErrorDispositivos(
        error instanceof Error
          ? error.message
          : 'No se pudo gestionar el dispositivo.',
      )
    } finally {
      setProcesandoDispositivo('')
    }
  }

  // =====================================================
  // EXPORTAR EXCEL
  // =====================================================

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
      [
        'Posición',
        'Nombre completo',
        'Institución',
        'Fecha de entrada',
        'Hora de entrada',
      ],
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

  // =====================================================
  // FILTRAR ASISTENTES
  // =====================================================

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

  // =====================================================
  // PANTALLA DE CARGA INICIAL
  // =====================================================

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

  // =====================================================
  // PANTALLA DE AUTORIZACIÓN DEL DISPOSITIVO
  // =====================================================

  if (session && deviceAccess !== 'approved') {
    const titulo =
      deviceAccess === 'pending'
        ? 'Acceso pendiente'
        : deviceAccess === 'revoked'
          ? 'Acceso revocado'
          : deviceAccess === 'unauthorized'
            ? 'Cuenta no autorizada'
            : deviceAccess === 'error'
              ? 'No se pudo verificar el acceso'
              : 'Verificando dispositivo'

    return (
      <main className="admin-page admin-loading">
        <div className="admin-shell">
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
              <span className="admin-kicker">
                SEGURIDAD DEL SISTEMA
              </span>

              <h1>{titulo}</h1>

              <p>{deviceAccessMessage}</p>
            </div>

            {deviceAccess === 'checking' && (
              <div className="admin-attendance-empty">
                <span className="admin-spinner" />
                <p>Comprobando los permisos de este dispositivo...</p>
              </div>
            )}

            {deviceAccess === 'pending' && (
              <div className="admin-attendance-empty">
                <span className="admin-empty-icon">⌘</span>

                <strong>Tu solicitud está en revisión.</strong>

                <p>
                  El responsable del sistema debe aprobar este
                  dispositivo antes de que puedas utilizar el panel.
                </p>

                <p>
                  Cuando recibas la aprobación, pulsa el botón
                  para comprobar nuevamente el acceso.
                </p>
              </div>
            )}

            {deviceAccess === 'revoked' && (
              <div className="admin-attendance-empty">
                <strong>Este dispositivo ya no tiene autorización.</strong>

                <p>
                  Contacta con el responsable del sistema si
                  consideras que se trata de un error.
                </p>
              </div>
            )}

            {deviceAccess === 'unauthorized' && (
              <div className="admin-attendance-empty">
                <strong>Tu cuenta no tiene permisos administrativos.</strong>

                <p>
                  Comprueba que estés utilizando una cuenta
                  registrada como administradora del evento.
                </p>
              </div>
            )}

            {deviceAccess === 'error' && (
              <div className="admin-attendance-empty">
                <strong>No pudimos comprobar tu autorización.</strong>

                <p>
                  Verifica tu conexión a internet e inténtalo nuevamente.
                </p>
              </div>
            )}

            {(deviceAccess === 'pending' ||
              deviceAccess === 'error') && (
              <button
                type="button"
                className="admin-primary admin-login-submit"
                onClick={() => void volverAComprobarAcceso()}
                disabled={comprobandoAcceso}
              >
                {comprobandoAcceso
                  ? 'Comprobando...'
                  : 'Comprobar autorización'}
              </button>
            )}

            <button
              type="button"
              className="admin-secondary"
              onClick={() => void cerrarSesion()}
            >
              Cerrar sesión
            </button>

            <div className="admin-login-footer">
              <span className="admin-security-dot" />
              Acceso protegido por autorización de dispositivos.
            </div>
          </section>
        </div>
      </main>
    )
  }

  // =====================================================
  // INTERFAZ PRINCIPAL
  // =====================================================

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
              <span className="admin-kicker">
                ACCESO ADMINISTRATIVO
              </span>

              <h1>Bienvenido de nuevo.</h1>

              <p>
                Accede al centro de control de Modela tu barrio
                para gestionar el ingreso y la asistencia del evento.
              </p>
            </div>

            <form className="admin-form" onSubmit={iniciarSesion}>
              <div className="admin-field">
                <label htmlFor="admin-email">
                  Correo electrónico
                </label>

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

                {puedeGestionarDispositivos && (
                  <button
                    type="button"
                    className={
                      vista === 'dispositivos'
                        ? 'admin-tab active'
                        : 'admin-tab'
                    }
                    onClick={() => {
                      setEscaneando(false)
                      setVista('dispositivos')
                      setMensaje('')
                      setAvisoDispositivo('')
                    }}
                  >
                    <span className="admin-tab-icon">⌘</span>
                    Solicitudes de acceso

                    {solicitudesPendientes.length > 0 && (
                      <span className="admin-request-count">
                        {solicitudesPendientes.length}
                      </span>
                    )}
                  </button>
                )}
              </div>

              {vista === 'scanner' ? (
                <section className="admin-workspace">
                  <div className="admin-section-heading">
                    <div>
                      <span className="admin-kicker">
                        VALIDACIÓN DE ENTRADAS
                      </span>

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

                            <p>
                              Apunta la cámara al código QR del participante.
                            </p>
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
              ) : vista === 'asistentes' ? (
                <section className="admin-attendance">
                  <div className="admin-attendance-heading">
                    <div>
                      <span className="admin-kicker">
                        CONTROL DE PARTICIPACIÓN
                      </span>

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

                      <p>
                        Cuando se validen los primeros códigos QR,
                        aparecerán aquí.
                      </p>
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
                                {asistente.organization ||
                                  'Institución no especificada'}
                              </span>
                            </div>

                            <div className="admin-attendee-time">
                              <strong>
                                {mostrarHora(asistente.checked_in_at)}
                              </strong>

                              <span>
                                {mostrarFecha(asistente.checked_in_at)}
                              </span>
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
                    disabled={
                      cargandoAsistentes || asistentes.length === 0
                    }
                  >
                    ↓ Descargar lista en Excel
                  </button>

                  <p className="admin-attendance-note">
                    El orden corresponde a la hora de entrada registrada
                    por el escáner QR.
                  </p>
                </section>
              ) : (
                <section className="admin-attendance">
                  <div className="admin-attendance-heading">
                    <div>
                      <span className="admin-kicker">
                        SEGURIDAD DEL SISTEMA
                      </span>

                      <h2>Solicitudes de acceso</h2>

                      <p>
                        Administra los dispositivos autorizados para
                        controlar las entradas del evento.
                      </p>
                    </div>

                    <div className="admin-attendance-count">
                      <strong>{solicitudesPendientes.length}</strong>
                      <span>pendientes</span>
                    </div>
                  </div>

                  {avisoDispositivo && (
                    <div className="admin-message" role="status">
                      {avisoDispositivo}

                      <button
                        type="button"
                        onClick={() => setAvisoDispositivo('')}
                        aria-label="Cerrar aviso"
                      >
                        ×
                      </button>
                    </div>
                  )}

                  {errorDispositivos && (
                    <p className="admin-message" role="alert">
                      {errorDispositivos}
                    </p>
                  )}

                  <div className="admin-attendance-actions">
                    <strong>Dispositivos registrados</strong>

                    <button
                      type="button"
                      className="admin-secondary admin-refresh"
                      disabled={cargandoDispositivos}
                      onClick={() => void actualizarDispositivos()}
                    >
                      ↻ {cargandoDispositivos ? 'Actualizando...' : 'Actualizar'}
                    </button>
                  </div>

                  {cargandoDispositivos ? (
                    <div className="admin-attendance-empty">
                      <span className="admin-spinner" />
                      <p>Cargando dispositivos...</p>
                    </div>
                  ) : dispositivos.length === 0 ? (
                    <div className="admin-attendance-empty">
                      <strong>No hay dispositivos registrados</strong>

                      <p>
                        Cuando un administrador intente acceder desde
                        un dispositivo nuevo, aparecerá aquí.
                      </p>
                    </div>
                  ) : (
                    <div className="admin-attendance-list">
                      {dispositivos.map(dispositivo => {
                        const pendiente =
                          !dispositivo.is_approved &&
                          !dispositivo.revoked_at

                        const aprobado =
                          dispositivo.is_approved &&
                          !dispositivo.revoked_at

                        return (
                          <article
                            className="admin-attendee admin-device-request"
                            key={dispositivo.id}
                          >
                            <span className="admin-attendee-position">
                              ⌘
                            </span>

                            <div className="admin-attendee-info">
                              <strong>{dispositivo.device_label}</strong>

                              <span>
                                Solicitado el{' '}
                                {mostrarFecha(dispositivo.created_at)}
                              </span>

                              <code>{dispositivo.device_id}</code>

                              <span>
                                Último uso:{' '}
                                {dispositivo.last_used_at
                                  ? `${mostrarFecha(dispositivo.last_used_at)} · ${mostrarHora(dispositivo.last_used_at)}`
                                  : 'Todavía no registrado'}
                              </span>
                            </div>

                            <div className="admin-device-actions">
                              {pendiente ? (
                                <>
                                  <span className="admin-device-status pending">
                                    Pendiente
                                  </span>

                                  <button
                                    type="button"
                                    className="admin-device-approve"
                                    disabled={
                                      procesandoDispositivo === dispositivo.id
                                    }
                                    onClick={() =>
                                      void gestionarDispositivo(
                                        dispositivo.id,
                                        'approve',
                                      )
                                    }
                                  >
                                    {procesandoDispositivo === dispositivo.id
                                      ? 'Procesando...'
                                      : 'Aprobar'}
                                  </button>

                                  <button
                                    type="button"
                                    className="admin-device-reject"
                                    disabled={
                                      procesandoDispositivo === dispositivo.id
                                    }
                                    onClick={() =>
                                      void gestionarDispositivo(
                                        dispositivo.id,
                                        'reject',
                                      )
                                    }
                                  >
                                    Rechazar
                                  </button>
                                </>
                              ) : aprobado ? (
                                <>
                                  <span className="admin-device-status approved">
                                    Aprobado
                                  </span>

                                  <button
                                    type="button"
                                    className="admin-device-reject"
                                    disabled={
                                      procesandoDispositivo === dispositivo.id
                                    }
                                    onClick={() =>
                                      void gestionarDispositivo(
                                        dispositivo.id,
                                        'revoke',
                                      )
                                    }
                                  >
                                    Revocar acceso
                                  </button>
                                </>
                              ) : (
                                <span className="admin-device-status revoked">
                                  Revocado
                                </span>
                              )}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}

                  <p className="admin-attendance-note">
                    La autorización se comprueba en el servidor.
                    Los dispositivos revocados no pueden utilizar el escáner.
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


import './App.css'
import { supabase } from './lib/supabase'
import { useEffect, useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import AdminScanner from './AdminScanner'

/* ───────────── DATOS ───────────── */

const equipo = [
  { nombre: 'Carlos Salazar', iniciales: 'CS', fotos: ['/equipo/carlos-salazar.jpg'] },
  { nombre: 'Luisanyer Navarro', iniciales: 'LN', fotos: ['/equipo/luisanyer-navarro.jpg'] },
  { nombre: 'Sarah Romero', iniciales: 'SR', fotos: ['/equipo/sarah-romero.jpg'] },
  { nombre: 'Jeyny Tejeda', iniciales: 'JT', fotos: ['/equipo/jeyny-tejeda.jpg'] },
  { nombre: 'Emmanuel Agüero', iniciales: 'EA', fotos: ['/equipo/emmanuel-aguero.jpg'] },
  { nombre: 'Aingeru Parla', iniciales: 'AP', fotos: ['/equipo/aingeru-parla.jpg'] },
  { nombre: 'Malvin Urbano', iniciales: 'MU', fotos: ['/equipo/malvin-urbano.jpg'] },
]

const degradados = [
  'linear-gradient(145deg,#E8472A,#F7B500)',
  'linear-gradient(145deg,#0F2F44,#E8472A)',
  'linear-gradient(145deg,#F7B500,#0F2F44)',
]

// Viernes 27 de noviembre de 2026, 6:00 PM (hora de República Dominicana)
const FECHA_LANZAMIENTO = new Date('2026-11-27T18:00:00-04:00').getTime()

function calcularRestante() {
  const diferencia = Math.max(0, FECHA_LANZAMIENTO - Date.now())
  return {
    dias: Math.floor(diferencia / 86_400_000),
    horas: Math.floor((diferencia / 3_600_000) % 24),
    minutos: Math.floor((diferencia / 60_000) % 60),
    segundos: Math.floor((diferencia / 1000) % 60),
    terminado: diferencia === 0,
  }
}

const dos = (n: number) => String(n).padStart(2, '0')

/* ───────────── TARJETA DEL EQUIPO ───────────── */

type Persona = (typeof equipo)[number]

function TarjetaEquipo({ persona, indice }: { persona: Persona; indice: number }) {
  const [actual, setActual] = useState(0)
  const [fallidas, setFallidas] = useState<string[]>([])

  const buenas = persona.fotos.filter(f => !fallidas.includes(f))
  const total = buenas.length === 0 ? 3 : buenas.length

  useEffect(() => {
    if (total < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let intervalo: number | undefined
    const inicio = window.setTimeout(() => {
      intervalo = window.setInterval(() => setActual(a => (a + 1) % total), 3500)
    }, indice * 500)

    return () => {
      window.clearTimeout(inicio)
      window.clearInterval(intervalo)
    }
  }, [total, indice])

  const visible = actual % total

  return (
    <figure className="tarjeta">
      {buenas.length === 0
        ? [0, 1, 2].map(k => (
            <div
              key={k}
              className={`lamina lamina-letras ${k === visible ? 'activa' : ''}`}
              style={{ background: degradados[(indice + k) % 3] }}
            >
              {persona.iniciales}
            </div>
          ))
        : buenas.map((src, k) => (
            <div key={src} className={`lamina ${k === visible ? 'activa' : ''}`}>
              <img
                src={src}
                alt={persona.nombre}
                loading="lazy"
                onError={() => setFallidas(f => [...f, src])}
              />
            </div>
          ))}
      <figcaption className="tarjeta-nombre">{persona.nombre}</figcaption>
    </figure>
  )
}

/* ───────────── COMPONENTE ───────────── */

function App() {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [organizacion, setOrganizacion] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [cargando, setCargando] = useState(false)
  const [qrImagen, setQrImagen] = useState('')
  const [mostrarAdmin, setMostrarAdmin] = useState(false)
  const [restante, setRestante] = useState(calcularRestante)

  useEffect(() => {
    const reloj = window.setInterval(() => setRestante(calcularRestante()), 1000)
    return () => window.clearInterval(reloj)
  }, [])

  async function registrarParticipante(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMensaje('')
    setQrImagen('')
    setCargando(true)

    try {
      const { data, error } = await supabase.rpc('register_attendee', {
        p_full_name: nombre.trim(),
        p_email: email.trim(),
        p_whatsapp: whatsapp.trim(),
        p_organization: organizacion.trim() || null,
      })

      if (error) throw new Error(error.message)

      const registro = Array.isArray(data) ? data[0] : data

      if (!registro?.qr_token) {
        throw new Error('No se recibió el código QR.')
      }

      const imagen = await QRCode.toDataURL(registro.qr_token, {
        width: 280,
        margin: 2,
        errorCorrectionLevel: 'M',
      })

      // Mostrar el QR aunque el envío del correo falle.
      setQrImagen(imagen)

      // Enviar el mismo QR al correo registrado.
      try {
        const { data: respuestaCorreo, error: errorCorreo } =
          await supabase.functions.invoke('send-registration-email', {
            body: {
              qrToken: registro.qr_token,
              qrImage: imagen,
            },
          })

        if (errorCorreo || !respuestaCorreo?.success) {
          console.error(
            'No se pudo enviar el correo:',
            errorCorreo || respuestaCorreo,
          )

          setMensaje(
            '¡Tu inscripción se completó correctamente! No pudimos enviar el QR por correo. Puedes descargarlo aquí.',
          )
        } else {
          setMensaje(
            '¡Tu inscripción se completó correctamente! También hemos enviado tu código QR al correo electrónico proporcionado.',
          )
        }
      } catch (errorCorreo) {
        console.error('Error al enviar el correo:', errorCorreo)

        setMensaje(
          '¡Tu inscripción se completó correctamente! No pudimos enviar el QR por correo. Puedes descargarlo aquí.',
        )
      }
    } catch (error) {
      const detalle = error instanceof Error
        ? error.message
        : 'Ocurrió un error inesperado.'

      setMensaje(`No se pudo completar la inscripción: ${detalle}`)
    } finally {
      setCargando(false)
    }
  }

  if (mostrarAdmin) {
    return <AdminScanner onVolver={() => setMostrarAdmin(false)} />
  }

  const bloqueado = cargando || Boolean(qrImagen)

  return (
    <div className="pagina">
      {/* ───── ENCABEZADO ───── */}
      <header className="encabezado">
        <a className="marca" href="#inicio">
          <img src="/logo-dreams-lab.png" alt="Logo de Fundación Dreams Lab" />
        </a>

        <nav className="menu" aria-label="Principal">
          <a href="#que-es">¿Qué es Modela Tu Barrio?</a>
          <a href="#equipo">Equipo organizador</a>
          <a href="#inscripcion">Inscripción</a>
        </nav>
      </header>

      {/* ───── PORTADA ───── */}
      <main className="portada" id="inicio">
        <div className="intro" id="que-es">
          <img
            className="logo-mtb"
            src="/logo-modela-tu-barrio.png"
            alt="Logo de Modela Tu Barrio"
          />
          <h1 className="definicion">
            Modela Tu Barrio es una iniciativa de la Fundación Dreams Lab
            para jóvenes de San Cristóbal. Cada barrio debe formar su
            Embajada (Equipo) para investigar su historia, conocer sus
            necesidades y proponer soluciones desde su propia comunidad.
          </h1>
        </div>

        <div className="lanzamiento">
          <p className="eslogan">
            <span className="e1">Conocer nuestra historia.</span>
            <span className="e2">Entender nuestro presente.</span>
            <span className="e3">Diseñar nuestro futuro.</span>
          </p>

          <p className="invitacion">
            {restante.terminado
              ? '¡El lanzamiento oficial ya comenzó!'
              : 'Conoce más acerca de nuestro proyecto el día oficial de lanzamiento en:'}
          </p>

          {!restante.terminado && (
            <div className="reloj" role="timer" aria-live="off">
              <div className="unidad"><span className="cifra">{dos(restante.dias)}</span><span className="etiqueta">días</span></div>
              <div className="unidad"><span className="cifra">{dos(restante.horas)}</span><span className="etiqueta">horas</span></div>
              <div className="unidad"><span className="cifra">{dos(restante.minutos)}</span><span className="etiqueta">min</span></div>
              <div className="unidad"><span className="cifra">{dos(restante.segundos)}</span><span className="etiqueta">seg</span></div>
            </div>
          )}

          <p className="fecha">Viernes 27 de noviembre · 6:00 PM · Villa Shantal</p>
        </div>
      </main>

      {/* ───── EQUIPO ───── */}
      <section className="equipo" id="equipo">
        <div className="equipo-cabecera">
          <h2>Las personas detrás de <span>Modela Tu Barrio</span></h2>
          <p>
            El equipo organizador del proyecto de <span>Modela Tu Barrio</span>{' '}
            que le ha dado vida al mismo.
          </p>
        </div>

        <div className="rejilla">
          {equipo.map((persona, i) => (
            <TarjetaEquipo key={persona.nombre} persona={persona} indice={i} />
          ))}
        </div>
      </section>

      {/* ───── INSCRIPCIÓN ───── */}
      <section className="inscripcion" id="inscripcion">
        <div>
          <h2>
            Inscríbete y forma parte de nuestro <span>lanzamiento oficial</span>
          </h2>
        </div>

        <div className="formulario">
          <form onSubmit={registrarParticipante}>
            <div className="campo">
              <label htmlFor="nombre">
                Nombre completo <span className="obligatorio" aria-hidden="true">*</span>
              </label>
              <input
                id="nombre"
                type="text"
                autoComplete="name"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                required
                disabled={bloqueado}
              />
            </div>

            <div className="campo">
              <label htmlFor="email">
                Correo electrónico <span className="obligatorio" aria-hidden="true">*</span>
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={bloqueado}
              />
            </div>

            <div className="campo">
              <label htmlFor="whatsapp">
                Número de teléfono (whatsapp) <span className="obligatorio" aria-hidden="true">*</span>
              </label>
              <input
                id="whatsapp"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+1 809 000 0000"
                value={whatsapp}
                onChange={e => setWhatsapp(e.target.value)}
                required
                disabled={bloqueado}
              />
            </div>

            <div className="campo">
              <label htmlFor="organizacion">
                Institución a la que representas <small>(opcional)</small>
              </label>
              <input
                id="organizacion"
                type="text"
                autoComplete="organization"
                value={organizacion}
                onChange={e => setOrganizacion(e.target.value)}
                disabled={bloqueado}
              />
            </div>

            <button className="boton" type="submit" disabled={bloqueado}>
              {cargando ? 'Registrando…' : 'Inscribirme'}
            </button>
          </form>

          {mensaje && (
            <p
              className={`mensaje ${qrImagen ? 'mensaje-ok' : 'mensaje-error'}`}
              role="status"
            >
              {mensaje}
            </p>
          )}

          {qrImagen && (
            <div className="resultado-qr">
              <h3>¡Tu inscripción está lista!</h3>
              <p>Guarda tu código QR y preséntalo al llegar.</p>
              <img src={qrImagen} alt="Código QR de inscripción" />
              <a
                href={qrImagen}
                download="mi-qr-modela-tu-barrio.png"
                className="boton"
              >
                Descargar mi QR
              </a>
            </div>
          )}
        </div>
      </section>

      <footer className="pie">
        <span>© 2026 Fundación Dreams Lab</span>
        <button className="enlace-admin" onClick={() => setMostrarAdmin(true)}>
          Administración
        </button>
      </footer>
    </div>
  )
}

export default App

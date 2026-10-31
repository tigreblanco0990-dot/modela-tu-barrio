import './App.css'
import { supabase } from './lib/supabase'
import { useEffect, useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import AdminScanner from './AdminScanner'

/* ───────────── DATOS ───────────── */

// Para poner las fotos: guarda cada imagen en /public/equipo/ con el
// nombre indicado en "foto". Si la imagen no existe, se muestran las iniciales.
const equipo = [
  { nombre: 'Carlos Salazar', iniciales: 'CS', foto: '/equipo/carlos-salazar.jpg' },
  { nombre: 'Luisanyer Navarro', iniciales: 'LN', foto: '/equipo/luisanyer-navarro.jpg' },
  { nombre: 'Sarah Romero', iniciales: 'SR', foto: '/equipo/sarah-romero.jpg' },
  { nombre: 'Jeyny Tejeda', iniciales: 'JT', foto: '/equipo/jeyny-tejeda.jpg' },
  { nombre: 'Emmanuel Agüero', iniciales: 'EA', foto: '/equipo/emmanuel-aguero.jpg' },
  { nombre: 'Aingeru Parla', iniciales: 'AP', foto: '/equipo/aingeru-parla.jpg' },
  { nombre: 'Malvin Urbano', iniciales: 'MU', foto: '/equipo/malvin-urbano.jpg' },
]

const barrios = [
  'Pueblo Nuevo',
  'Jeringa',
  'Las Flores',
  'Los Nova',
  'Lava Pie',
  'Canastica',
  '5 de Abril',
  'Moscú',
  'Los Americanos',
  'Barrio Nuevo',
  'Barrio Puerto Rico',
  'Villa Mercedes',
]

const fases = [
  {
    numero: 'I',
    titulo: 'Diseño y organización',
    detalle: 'Metodología, manuales, plataforma, identidad gráfica y mentores aliados.',
    tiempo: '3 semanas',
  },
  {
    numero: 'II',
    titulo: 'Lanzamiento e inscripciones',
    detalle: 'Evento oficial y acreditación de las Embajadas por sector.',
    tiempo: '20 nov – 3 dic',
  },
  {
    numero: 'III',
    titulo: 'Campamento de formación',
    detalle: 'Liderazgo, debate estilo MUN, investigación, oratoria, audiovisual y uso responsable de IA.',
    tiempo: 'Sábados intensivos',
  },
  {
    numero: 'IV',
    titulo: 'Investigación en los barrios',
    detalle: 'Entrevistas, fotografías, el Día del Barrio y retos semanales digitales.',
    tiempo: '4 a 6 semanas',
  },
  {
    numero: 'V',
    titulo: 'Gran Asamblea Juvenil',
    detalle: 'Presentación de expedientes, debate, negociación entre barrios y Agenda Juvenil.',
    tiempo: '1 día completo',
  },
]

const roles = [
  { cantidad: 1, nombre: 'Coordinador/a', detalle: 'Lidera y da seguimiento al equipo.' },
  { cantidad: 4, nombre: 'Investigación', detalle: 'Historia, archivos y entrevistas.' },
  { cantidad: 4, nombre: 'Comunicación', detalle: 'Foto, video, podcast y redes.' },
  { cantidad: 4, nombre: 'Proyectos', detalle: 'Necesidades, activos y propuestas.' },
  { cantidad: 2, nombre: 'Voceros', detalle: 'Presentan y debaten en la Asamblea.' },
]

const entregables = [
  {
    titulo: 'Expediente del Barrio',
    texto: 'Historia, memoria viva, diagnóstico, mapa de talentos y desafíos de tu comunidad.',
  },
  {
    titulo: '“Mi Barrio en 5 Minutos”',
    texto: 'Un cortometraje documental con entrevistas a quienes vieron nacer el barrio.',
  },
  {
    titulo: 'Pasaporte de Mi Barrio',
    texto: 'La carta de presentación visual de tu sector ante la Asamblea.',
  },
  {
    titulo: 'Archivo fotográfico',
    texto: 'Fotos históricas rescatadas y el efecto “Antes y Ahora”.',
  },
]

const premios = [
  'Mejor Embajada',
  'Mejor Investigación Histórica y Comunitaria',
  'Mejor Documental',
  'Mejor Propuesta de Desarrollo',
  'Mejor Orador/a',
  'Premio Identidad Sancristobalense',
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

/* ───────────── COMPONENTE ───────────── */

function App() {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [organizacion, setOrganizacion] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [cargando, setCargando] = useState(false)
  const [qrImagen, setQrImagen] = useState('')
  const [mostrarAdmin, setMostrarAdmin] = useState(false)
  const [personaActual, setPersonaActual] = useState(0)
  const [restante, setRestante] = useState(calcularRestante)

  useEffect(() => {
    const intervalo = window.setInterval(() => {
      setPersonaActual(actual => (actual + 1) % equipo.length)
    }, 4500)

    return () => window.clearInterval(intervalo)
  }, [])

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

      setQrImagen(imagen)
      setMensaje('¡Tu inscripción se completó correctamente!')
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

  return (
    <main className="pagina">
      {/* ───── BARRA ───── */}
      <header className="barra">
        <a className="marca" href="#inicio">
          <img
            className="marca-logo"
            src="/logo-dreams-lab.png"
            alt="Fundación Dreams Lab"
          />
          <span className="marca-texto">
            MODELA <b>TU BARRIO</b>
          </span>
        </a>

        <nav className="navegacion">
          <a href="#proyecto">El proyecto</a>
          <a href="#ruta">La ruta</a>
          <a href="#barrios">Los barrios</a>
          <a href="#equipo">El equipo</a>
          <a href="#inscripcion">Inscripción</a>
          <button
            className="enlace-admin"
            onClick={() => setMostrarAdmin(true)}
          >
            Administración
          </button>
        </nav>

        <a className="boton boton-pequeno" href="#inscripcion">
          Participar ↗
        </a>
      </header>

      {/* ───── PORTADA ───── */}
      <section className="portada" id="inicio">
        <div className="portada-brillo" aria-hidden="true" />

        <div className="portada-contenido">
          <div className="etiqueta">
            <i /> JUVENTUD · IDENTIDAD · COMUNIDAD
          </div>

          <p className="fundacion">
            UNA INICIATIVA DE FUNDACIÓN DREAMS LAB
          </p>

          <h1>
            Tu barrio.<br />
            Tus ideas.<br />
            <span>Tu futuro.</span>
          </h1>

          <p className="descripcion">
            Jóvenes de 15 a 25 años que investigan, representan y
            proponen. Cada barrio de San Cristóbal tendrá su
            Embajada para contar su historia y diseñar su futuro.
          </p>

          <div className="portada-acciones">
            <a className="boton" href="#inscripcion">
              Quiero participar ↗
            </a>
            <a className="boton boton-borde" href="#ruta">
              Ver la ruta
            </a>
          </div>

          <p className="nota">San Cristóbal, República Dominicana</p>
        </div>

        <div className="grafico">
          <div className="grafico-orbita" aria-hidden="true" />
          <img
            className="grafico-logo"
            src="/logo-dreams-lab.png"
            alt="Logo de Fundación Dreams Lab"
          />

          <div className="cuenta">
            <span className="cuenta-titulo">
              {restante.terminado ? 'EL LANZAMIENTO YA OCURRIÓ' : 'LANZAMIENTO OFICIAL EN'}
            </span>

            {!restante.terminado && (
              <div className="cuenta-cifras">
                <div><strong>{dos(restante.dias)}</strong><small>días</small></div>
                <div><strong>{dos(restante.horas)}</strong><small>horas</small></div>
                <div><strong>{dos(restante.minutos)}</strong><small>min</small></div>
                <div><strong>{dos(restante.segundos)}</strong><small>seg</small></div>
              </div>
            )}

            <span className="cuenta-fecha">
              Viernes 27 de noviembre · 6:00 PM
            </span>
          </div>
        </div>

        <div className="franja">
          <div className="franja-pista">
            {[0, 1].map(vuelta => (
              <span key={vuelta}>
                HISTORIA ✳ IDENTIDAD ✳ LIDERAZGO JUVENIL ✳ MEMORIA VIVA ✳ FUTURO ✳{' '}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ───── QUÉ ES ───── */}
      <section className="manifiesto" id="proyecto">
        <div>
          <span className="sobrelinea">¿QUÉ ES MODELA TU BARRIO?</span>
          <h2>
            Un Modelo de Naciones Unidas, pero <em>de barrios.</em>
          </h2>
        </div>

        <div className="manifiesto-texto">
          <p>
            En lugar de representar países, las delegaciones juveniles
            representan con orgullo los barrios y comunidades de
            San Cristóbal. Cada barrio conforma una <strong>embajada</strong>.
          </p>
          <p>
            Los participantes se convierten en <strong>Embajadores de sus
            Barrios</strong>: investigan su historia, recuperan fotografías y
            testimonios, identifican necesidades y oportunidades, y presentan
            propuestas concretas de desarrollo comunitario.
          </p>
        </div>
      </section>

      <section className="pilares">
        <article className="pilar">
          <span>01</span>
          <div>
            <h3>Conocer nuestra historia</h3>
            <p>
              Fundadores, familias emblemáticas, tradiciones y la
              memoria que hoy viven los adultos mayores.
            </p>
          </div>
        </article>

        <article className="pilar">
          <span>02</span>
          <div>
            <h3>Entender nuestro presente</h3>
            <p>
              Mapear talentos, activos, servicios y las necesidades
              prioritarias de cada comunidad.
            </p>
          </div>
        </article>

        <article className="pilar">
          <span>03</span>
          <div>
            <h3>Diseñar nuestro futuro</h3>
            <p>
              Convertir las ideas de la juventud en proyectos y
              propuestas, incluso junto a otros barrios.
            </p>
          </div>
        </article>
      </section>

      {/* ───── CIFRAS ───── */}
      <section className="alcance">
        <div className="alcance-titulo">
          <span className="sobrelinea claro">PLAN PILOTO · PRIMERA EDICIÓN</span>
          <h2>El cambio empieza desde nuestros barrios.</h2>
        </div>

        <div className="alcance-dato">
          <strong>12</strong>
          <span>barrios emblemáticos de San Cristóbal</span>
        </div>

        <div className="alcance-dato">
          <strong>15</strong>
          <span>Embajadores por cada barrio</span>
        </div>

        <div className="alcance-dato">
          <strong>180</strong>
          <span>jóvenes participantes en total</span>
        </div>
      </section>

      {/* ───── RUTA ───── */}
      <section className="ruta" id="ruta">
        <div className="seccion-cabecera">
          <div>
            <span className="sobrelinea">CÓMO FUNCIONA</span>
            <h2>
              Cinco fases, <em>un solo recorrido.</em>
            </h2>
          </div>
          <p>
            Desde la formación hasta la gran asamblea donde los jóvenes
            entregan su Agenda a las autoridades.
          </p>
        </div>

        <ol className="fases">
          {fases.map(fase => (
            <li className="fase" key={fase.numero}>
              <span className="fase-numero">{fase.numero}</span>
              <h3>{fase.titulo}</h3>
              <p>{fase.detalle}</p>
              <small>{fase.tiempo}</small>
            </li>
          ))}
        </ol>
      </section>

      {/* ───── EMBAJADA ───── */}
      <section className="embajada">
        <div className="embajada-intro">
          <span className="sobrelinea claro">TU EMBAJADA</span>
          <h2>
            15 jóvenes. <em>Un barrio.</em>
          </h2>
          <p>
            Cada Embajada Comunitaria se organiza en equipos con roles
            claros, y juntos construyen todo lo que el barrio presentará.
          </p>

          <ul className="entregables">
            {entregables.map(item => (
              <li key={item.titulo}>
                <strong>{item.titulo}</strong>
                <span>{item.texto}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="roles">
          {roles.map(rol => (
            <div className="rol" key={rol.nombre}>
              <strong>{rol.cantidad}</strong>
              <div>
                <h3>{rol.nombre}</h3>
                <p>{rol.detalle}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ───── BARRIOS ───── */}
      <section className="barrios-seccion" id="barrios">
        <div className="seccion-cabecera">
          <div>
            <span className="sobrelinea">UNA IDENTIDAD, MUCHAS HISTORIAS</span>
            <h2>
              12 barrios.<br />
              <em>Un mismo futuro.</em>
            </h2>
          </div>

          <p>
            Cada comunidad tiene una historia que contar, talentos
            que mostrar y oportunidades que construir.
          </p>
        </div>

        <div className="barrios-lista">
          {barrios.map((barrio, index) => (
            <div className="barrio-item" key={barrio}>
              <span>{dos(index + 1)}</span>
              {barrio}
            </div>
          ))}
        </div>

        <p className="nota-seccion">
          Sectores del plan piloto de la primera edición.
        </p>
      </section>

      {/* ───── PREMIOS ───── */}
      <section className="premios">
        <div className="premios-texto">
          <span className="sobrelinea">RECONOCIMIENTOS</span>
          <h2>
            Aprender es lo central. <em>Ganar, un impulso.</em>
          </h2>
          <p>
            Un jurado multidisciplinario evalúa a las Embajadas en la
            Gran Plenaria. El barrio ganador recibe un impacto tangible:
            el <strong>“Proyecto Dreams Lab para Mi Barrio”</strong>, con
            el que se gestionan recursos para ejecutar una de sus propuestas.
          </p>
        </div>

        <ul className="premios-lista">
          {premios.map(premio => (
            <li key={premio}>
              <i>✳</i> {premio}
            </li>
          ))}
        </ul>
      </section>

      {/* ───── EQUIPO ───── */}
      <section className="equipo-seccion" id="equipo">
        <div className="equipo-intro">
          <span className="sobrelinea">LAS PERSONAS DETRÁS DE LA IDEA</span>

          <h2>
            Un equipo que cree en el poder de <em>la juventud.</em>
          </h2>

          <p>Conoce al equipo organizador de MODELA TU BARRIO.</p>

          <div className="equipo-controles">
            <button
              aria-label="Anterior"
              onClick={() =>
                setPersonaActual(
                  (personaActual - 1 + equipo.length) % equipo.length
                )
              }
            >
              ←
            </button>

            <span>
              {dos(personaActual + 1)} / {dos(equipo.length)}
            </span>

            <button
              aria-label="Siguiente"
              onClick={() =>
                setPersonaActual((personaActual + 1) % equipo.length)
              }
            >
              →
            </button>
          </div>

          <div className="equipo-puntos">
            {equipo.map((p, i) => (
              <button
                key={p.nombre}
                aria-label={p.nombre}
                className={i === personaActual ? 'activo' : ''}
                onClick={() => setPersonaActual(i)}
              />
            ))}
          </div>
        </div>

        <div className="persona-escenario">
          {equipo.map((p, i) => (
            <article
              key={p.nombre}
              className={`persona-card ${i === personaActual ? 'visible' : ''}`}
              aria-hidden={i !== personaActual}
            >
              <div className="persona-foto">
                <span className="persona-iniciales">{p.iniciales}</span>
                <img
                  src={p.foto}
                  alt={p.nombre}
                  loading="lazy"
                  onError={e => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              </div>

              <div className="persona-info">
                <span>Equipo organizador</span>
                <h3>{p.nombre}</h3>
                <small>MODELA TU BARRIO · 2026</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ───── INSCRIPCIÓN ───── */}
      <section className="inscripcion" id="inscripcion">
        <div className="inscripcion-texto">
          <span className="sobrelinea claro">TU MOMENTO EMPIEZA AQUÍ</span>

          <h2>
            Tu voz también puede transformar <em>tu comunidad.</em>
          </h2>

          <p>
            Postúlate para formar parte de MODELA TU BARRIO y representar
            la historia, las ideas y el futuro de tu sector.
          </p>

          <ul className="inscripcion-datos">
            <li><b>Quiénes:</b> jóvenes de 15 a 25 años de San Cristóbal</li>
            <li><b>Inscripciones:</b> del 20 de noviembre al 3 de diciembre</li>
            <li><b>Lanzamiento:</b> viernes 27 de noviembre, 6:00 PM</li>
          </ul>

          <div className="inscripcion-frase">
            “Conocer nuestra historia. Entender nuestro presente.
            Diseñar nuestro futuro.”
          </div>
        </div>

        <div className="tarjeta-formulario">
          <div className="formulario-cabecera">
            <span>01 / REGISTRO</span>
            <span className="estado">● INSCRIPCIÓN EN LÍNEA</span>
          </div>

          <h3>¡Queremos conocerte!</h3>
          <p className="formulario-descripcion">
            Completa tus datos para iniciar tu inscripción.
          </p>

          <form onSubmit={registrarParticipante}>
            <div className="campo">
              <label htmlFor="nombre">Nombre completo *</label>
              <input
                id="nombre"
                type="text"
                placeholder="Escribe tu nombre y apellido"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                required
                disabled={cargando || Boolean(qrImagen)}
              />
            </div>

            <div className="campo">
              <label htmlFor="email">Correo electrónico *</label>
              <input
                id="email"
                type="email"
                placeholder="tunombre@correo.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={cargando || Boolean(qrImagen)}
              />
            </div>

            <div className="campo">
              <label htmlFor="organizacion">
                Institución a la que representas (opcional)
              </label>
              <input
                id="organizacion"
                type="text"
                placeholder="Centro educativo u organización"
                value={organizacion}
                onChange={e => setOrganizacion(e.target.value)}
                disabled={cargando || Boolean(qrImagen)}
              />
            </div>

            <button
              className="boton boton-formulario"
              type="submit"
              disabled={cargando || Boolean(qrImagen)}
            >
              {cargando ? 'Registrando...' : 'Enviar mi inscripción'} ↗
            </button>
          </form>

          {mensaje && (
            <p className="mensaje-formulario" role="status">
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
                Descargar mi QR ↓
              </a>
            </div>
          )}

          <p className="aviso-formulario">
            Tus datos se utilizarán para gestionar tu inscripción.
            Consulta el aviso de privacidad oficial de la organización.
          </p>
        </div>
      </section>

      {/* ───── CIERRE ───── */}
      <section className="cierre">
        <img
          className="cierre-logo"
          src="/logo-dreams-lab.png"
          alt=""
          aria-hidden="true"
        />
        <span className="sobrelinea claro">MODELA TU BARRIO</span>

        <h2>
          Tu barrio tiene mucho que <em>decir.</em>
        </h2>

        <a className="boton" href="#inscripcion">
          Sé parte de la historia ↗
        </a>
      </section>

      <footer className="pie">
        <a className="marca" href="#inicio">
          <img
            className="marca-logo"
            src="/logo-dreams-lab.png"
            alt="Fundación Dreams Lab"
          />
          <span className="marca-texto">
            MODELA <b>TU BARRIO</b>
          </span>
        </a>

        <p>
          Conocer nuestra historia. Entender nuestro presente.
          Diseñar nuestro futuro.
        </p>

        <span>© 2026 FUNDACIÓN DREAMS LAB</span>
      </footer>
    </main>
  )
}

export default App
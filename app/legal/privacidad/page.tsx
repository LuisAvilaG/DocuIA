import type { Metadata } from "next";
import { SiteNav, SiteFooter, ContactModal, SiteMotion } from "@/components/landing/site-chrome";
import "@/components/landing/landing.css";

export const metadata: Metadata = {
  title: "Aviso de privacidad | DocuIA",
  description: "Cómo DocuIA recaba, usa y protege tus datos personales.",
};

export default function PrivacidadPage() {
  return (
    <div className="lp">
      <SiteMotion />
      <SiteNav />

      <article className="legal">
        <p className="kicker">Legal</p>
        <h1>Aviso de privacidad</h1>
        <p className="updated">Última actualización: por definir en la publicación.</p>

        <div className="note">
          Este documento es una base preparada para DocuIA. Antes de publicarlo debe completarse
          con los datos de la entidad legal y ser revisado por asesoría jurídica para asegurar su
          cumplimiento con la Ley Federal de Protección de Datos Personales en Posesión de los
          Particulares (México) y demás normativa aplicable.
        </div>

        <h2>1. Identidad y domicilio del responsable</h2>
        <p>
          <strong>[Razón social]</strong> (“DocuIA”, “nosotros”), con domicilio en <strong>[domicilio fiscal]</strong>
          y RFC <strong>[RFC]</strong>, es responsable del tratamiento de tus datos personales conforme al
          presente aviso.
        </p>

        <h2>2. Datos personales que recabamos</h2>
        <p>Recabamos los datos que nos proporcionas directamente y los necesarios para prestar el servicio:</p>
        <ul>
          <li><strong>De contacto y comerciales:</strong> nombre, correo electrónico laboral, empresa y teléfono, cuando solicitas una demo o nos contactas.</li>
          <li><strong>De cuenta:</strong> nombre, correo y credenciales de acceso de los usuarios de la organización cliente.</li>
          <li><strong>De uso del servicio:</strong> el contenido de los documentos que subes o procesas (facturas, gastos, contratos y sus datos), así como registros de actividad para auditoría y seguridad.</li>
        </ul>
        <p>No recabamos datos personales sensibles de manera intencional a través del sitio.</p>

        <h2>3. Finalidades del tratamiento</h2>
        <p><strong>Finalidades primarias</strong> (necesarias para el servicio):</p>
        <ul>
          <li>Atender tu solicitud de demo o contacto y darte seguimiento comercial.</li>
          <li>Prestar, operar y dar soporte a la plataforma.</li>
          <li>Procesar los documentos que cargas para extraer, validar y sincronizar su información con tu ERP o generar los documentos de salida.</li>
          <li>Mantener la seguridad, el registro de auditoría y el cumplimiento legal.</li>
        </ul>
        <p><strong>Finalidades secundarias</strong> (no necesarias; puedes oponerte):</p>
        <ul>
          <li>Envío de comunicaciones sobre novedades del producto.</li>
        </ul>
        <p>Si no deseas que tus datos se usen para las finalidades secundarias, puedes indicarlo escribiéndonos al correo señalado más abajo.</p>

        <h2>4. Tratamiento de los documentos de nuestros clientes</h2>
        <p>
          Los documentos y datos que una organización cliente procesa en la plataforma se tratan bajo su
          instrucción y bajo aislamiento por organización. <strong>No usamos esos documentos para entrenar
          modelos.</strong> Se conservan bajo el control del cliente y con la política de retención que
          configure. Respecto de esa información, la organización cliente es responsable y DocuIA actúa como
          encargado.
        </p>

        <h2>5. Transferencias y encargados</h2>
        <p>
          Para operar el servicio nos apoyamos en proveedores de infraestructura y de procesamiento con IA que
          actúan como encargados y solo tratan los datos conforme a nuestras instrucciones. No vendemos ni
          comercializamos tus datos personales. Cualquier transferencia que requiera tu consentimiento se te
          informará de forma previa.
        </p>

        <h2>6. Medios para ejercer tus derechos ARCO</h2>
        <p>
          Tienes derecho a acceder, rectificar y cancelar tus datos personales, así como a oponerte a su
          tratamiento y a revocar tu consentimiento. Para ejercerlos, escríbenos a{" "}
          <a href="mailto:privacidad@docuia.com">privacidad@docuia.com</a> indicando tu solicitud y los medios
          para acreditar tu identidad. Responderemos en los plazos que marca la normativa aplicable.
        </p>

        <h2>7. Cookies y tecnologías de rastreo</h2>
        <p>
          El sitio puede usar cookies o tecnologías similares para su funcionamiento y, en su caso, para medir
          el uso de la página. Puedes configurar tu navegador para limitarlas.
        </p>

        <h2>8. Cambios al aviso de privacidad</h2>
        <p>
          Podemos actualizar este aviso. Publicaremos cualquier cambio en esta página, indicando la fecha de la
          última actualización.
        </p>

        <h2>9. Consentimiento</h2>
        <p>
          Al proporcionarnos tus datos personales manifiestas tu conformidad con el presente aviso de
          privacidad.
        </p>
      </article>

      <SiteFooter />
      <ContactModal interest="Aviso de privacidad" />
    </div>
  );
}

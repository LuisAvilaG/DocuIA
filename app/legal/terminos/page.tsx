import type { Metadata } from "next";
import { SiteNav, SiteFooter, ContactModal, SiteMotion } from "@/components/landing/site-chrome";
import "@/components/landing/landing.css";

export const metadata: Metadata = {
  title: "Términos y condiciones | DocuIA",
  description: "Términos que rigen el uso de la plataforma DocuIA.",
};

export default function TerminosPage() {
  return (
    <div className="lp">
      <SiteMotion />
      <SiteNav />

      <article className="legal">
        <p className="kicker">Legal</p>
        <h1>Términos y condiciones</h1>
        <p className="updated">Última actualización: por definir en la publicación.</p>

        <div className="note">
          Este documento es una base preparada para DocuIA. Antes de publicarlo debe completarse con los
          datos de la entidad legal y ser revisado por asesoría jurídica; las condiciones comerciales
          definitivas se pactan en el contrato de servicio con cada cliente.
        </div>

        <h2>1. Aceptación</h2>
        <p>
          Estos términos rigen el acceso y uso del sitio y de la plataforma de <strong>[Razón social]</strong>
          (“DocuIA”). Al usarlos, aceptas estos términos. Si contratas en nombre de una organización, declaras
          tener facultades para obligarla.
        </p>

        <h2>2. Descripción del servicio</h2>
        <p>
          DocuIA es una plataforma de procesamiento de documentos con inteligencia artificial que extrae,
          valida e integra información de facturas, gastos y contratos hacia el ERP del cliente o hacia
          documentos de salida. El alcance específico depende de los productos contratados.
        </p>

        <h2>3. Cuentas y acceso</h2>
        <p>
          El acceso a la plataforma requiere credenciales. El cliente es responsable de mantener la
          confidencialidad de las mismas y de la actividad realizada bajo su cuenta, así como de administrar
          los permisos de sus usuarios.
        </p>

        <h2>4. Uso aceptable</h2>
        <p>Te comprometes a no usar el servicio para fines ilícitos ni a:</p>
        <ul>
          <li>Cargar contenido sobre el que no tengas derechos o autorización.</li>
          <li>Intentar vulnerar la seguridad, integridad o disponibilidad de la plataforma.</li>
          <li>Usar el servicio de forma que infrinja derechos de terceros o la normativa aplicable.</li>
        </ul>

        <h2>5. Datos del cliente y confidencialidad</h2>
        <p>
          Los documentos y datos que el cliente procesa siguen siendo de su propiedad. DocuIA los trata
          conforme al <a href="/legal/privacidad">Aviso de privacidad</a> y al contrato de servicio, bajo
          aislamiento por organización, y no los usa para entrenar modelos. Ambas partes guardarán
          confidencialidad de la información que intercambien.
        </p>

        <h2>6. Propiedad intelectual</h2>
        <p>
          La plataforma, su software, marca y contenidos son propiedad de DocuIA o de sus licenciantes. Estos
          términos no transfieren derecho de propiedad intelectual alguno más allá del uso del servicio
          contratado.
        </p>

        <h2>7. Disponibilidad</h2>
        <p>
          Procuramos una alta disponibilidad del servicio. Los niveles de servicio (SLA) específicos, cuando
          apliquen, se establecen en el contrato de servicio correspondiente. Podremos realizar mantenimientos
          programados notificando cuando sea razonable.
        </p>

        <h2>8. Limitación de responsabilidad</h2>
        <p>
          El servicio se presta “tal cual”. En la máxima medida permitida por la ley, DocuIA no será
          responsable por daños indirectos o consecuenciales. La responsabilidad total se limitará conforme a
          lo pactado en el contrato de servicio. El cliente es responsable de revisar los resultados antes de
          registrarlos de forma definitiva en sus sistemas.
        </p>

        <h2>9. Vigencia y terminación</h2>
        <p>
          La relación se rige por el contrato de servicio suscrito. Podremos suspender el acceso ante un uso
          que incumpla estos términos o ponga en riesgo la plataforma.
        </p>

        <h2>10. Ley aplicable</h2>
        <p>
          Estos términos se rigen por las leyes aplicables en <strong>[jurisdicción]</strong>, y cualquier
          controversia se someterá a los tribunales competentes de dicha jurisdicción.
        </p>

        <h2>11. Contacto</h2>
        <p>
          Para dudas sobre estos términos, escríbenos a <a href="mailto:legal@docuia.com">legal@docuia.com</a>.
        </p>
      </article>

      <SiteFooter />
      <ContactModal interest="Términos y condiciones" />
    </div>
  );
}

import { supabase } from "./supabase.js";

const lista = document.querySelector("#lista-proveedores");
const resumen = document.querySelector("#resumen-proveedores");
const estado = document.querySelector("#estado-proveedores");
const recargar = document.querySelector("#recargar-proveedores");

let cargando = false;

function elemento(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);

  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;

  return nodo;
}

function crearTarjeta(proveedor) {
  const tarjeta = elemento("article", "proveedor");
  const encabezado = elemento("div", "proveedor-encabezado");

  encabezado.append(
    elemento("h2", "", proveedor.nombre),
    elemento(
      "span",
      "estado",
      proveedor.activo ? "Activo" : "Inactivo"
    )
  );

  const datos = elemento("dl", "proveedor-datos");

  const filas = [
    ["Contacto", proveedor.contacto],
    ["Teléfono", proveedor.telefono],
    ["WhatsApp", proveedor.whatsapp],
    ["Correo", proveedor.correo],
    ["Dirección", proveedor.direccion],
    ["Condiciones", proveedor.condiciones]
  ];

  for (const [titulo, valor] of filas) {
    datos.append(
      elemento("dt", "", titulo),
      elemento("dd", "", valor || "Sin registrar")
    );
  }

  const detalles = elemento("details");
  const desplegar = elemento("summary", "", "Editar datos");
  const formulario = elemento("form");

  const campos = [
    ["contacto", "Persona de contacto", "text"],
    ["telefono", "Teléfono", "tel"],
    ["whatsapp", "WhatsApp con código de país", "tel"],
    ["correo", "Correo electrónico", "email"],
    ["direccion", "Dirección", "textarea"],
    ["condiciones", "Condiciones de compra", "textarea"]
  ];

  for (const [nombre, titulo, tipo] of campos) {
    const id = `${proveedor.id}-${nombre}`;
    const label = elemento("label", "", titulo);
    label.htmlFor = id;

    const control = elemento(
      tipo === "textarea" ? "textarea" : "input"
    );

    if (tipo !== "textarea") control.type = tipo;

    control.id = id;
    control.name = nombre;
    control.value = proveedor[nombre] || "";
    control.maxLength = tipo === "textarea" ? 3000 : 250;

    if (nombre === "whatsapp") {
      control.placeholder = "Ej. +52 951 123 4567";
    }

    formulario.append(label, control);
  }

  const guardar = elemento(
    "button",
    "boton-principal",
    "Guardar cambios"
  );
  guardar.type = "submit";

  const mensaje = elemento("p", "mensaje");
  mensaje.setAttribute("role", "status");

  formulario.append(guardar, mensaje);
  detalles.append(desplegar, formulario);
  tarjeta.append(encabezado, datos, detalles);

  formulario.addEventListener("submit", async (event) => {
    event.preventDefault();

    guardar.disabled = true;
    guardar.textContent = "Guardando…";
    mensaje.textContent = "";

    try {
      const valores = new FormData(formulario);
      const cambios = {};

      for (const [nombre] of campos) {
        cambios[nombre] =
          String(valores.get(nombre) || "").trim() || null;
      }

      const { data, error } = await supabase
        .from("proveedores")
        .update(cambios)
        .eq("id", proveedor.id)
        .select(
          "id,nombre,activo,contacto,telefono,whatsapp," +
          "correo,direccion,condiciones"
        )
        .single();

      if (error) throw error;

      const nuevaTarjeta = crearTarjeta(data);
      tarjeta.replaceWith(nuevaTarjeta);

      estado.textContent = `Datos de ${data.nombre} guardados.`;
      estado.style.color = "var(--verde)";

      nuevaTarjeta.querySelector("summary").focus();
    } catch (error) {
      console.error("Error al guardar proveedor:", error);
      mensaje.textContent =
        "No se guardaron los cambios. Revisa la conexión y tu sesión.";
    } finally {
      guardar.disabled = false;
      guardar.textContent = "Guardar cambios";
    }
  });

  return tarjeta;
}

export async function cargarProveedores() {
  if (cargando) return;

  cargando = true;
  recargar.disabled = true;
  estado.textContent = "";
  estado.style.color = "";
  resumen.textContent = "Cargando proveedores…";
  lista.replaceChildren();

  try {
    const { data, error } = await supabase
      .from("proveedores")
      .select(
        "id,nombre,activo,contacto,telefono,whatsapp," +
        "correo,direccion,condiciones"
      )
      .order("nombre");

    if (error) throw error;

    resumen.textContent =
      `${data.length} proveedor${data.length === 1 ? "" : "es"} registrado${data.length === 1 ? "" : "s"}`;

    if (data.length === 0) {
      estado.textContent =
        "No hay proveedores visibles para esta sesión.";
      return;
    }

    lista.replaceChildren(...data.map(crearTarjeta));
  } catch (error) {
    console.error("Error al cargar proveedores:", error);
    resumen.textContent = "No se pudo cargar el directorio.";
    estado.textContent =
      "Revisa tu conexión y pulsa Actualizar. Si continúa, cierra sesión y vuelve a entrar.";
  } finally {
    cargando = false;
    recargar.disabled = false;
  }
}

recargar.addEventListener("click", cargarProveedores);
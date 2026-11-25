import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// AQUÍ VA TU LLAVE
// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAuYdR8wh9xfX2kAV5EMVjrSNoeyyzS9cU",
  authDomain: "datos-anuncios.firebaseapp.com",
  projectId: "datos-anuncios",
  storageBucket: "datos-anuncios.firebasestorage.app",
  messagingSenderId: "238973626573",
  appId: "1:238973626573:web:d6a336606ebe21a1c16184"
};
// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
// ABAJO DE ESTO YA VA TODO TU CÓDIGO QUE YA TENÍAS
// tu función confirmar(), abrirForm(), cerrarForm(), etc.

function abrirForm(){
    document.getElementById("formulario").classList.add("mostrar");
}
function cerrarForm(){
    document.getElementById("formulario").classList.remove("mostrar");
}
async function confirmar(){
  let nombre=document.getElementById("nombre").value;
  let precio=document.getElementById("precio").value;
  let descripcion=document.getElementById("descripcion").value;
  let archivoImagen=document.getElementById("imagen").files[0];
  let ubicacion=document.getElementById("ubicacion").value;

  if(nombre==""||precio=="")return;

  // 1. SUBIMOS LA FOTO A IMGBB, EL USUARIO SOLO ESCOGIÓ EL ARCHIVO
  let urlImagen = "";
  if(archivoImagen){
    let formData = new FormData();
    formData.append("image", archivoImagen);

    let respuesta = await fetch("https://api.imgbb.com/1/upload?key=5132c723645e0ba0a7e9633fe959b2eb", {
      method: "POST",
      body: formData
    });
    let datos = await respuesta.json();
    urlImagen = datos.data.url;
  }

  // 2. GUARDAMOS TODO EN FIRESTORE, YA CON EL LINK DE LA FOTO
  let nuevoDoc= await addDoc(collection(db, "anuncios"), {
    nombre: nombre,
    precio: precio,
    descripcion: descripcion,
    ubicacion: ubicacion,
    imagen: urlImagen,
    fecha: new Date().toLocaleString()
  });

  // 3. CREAMOS TU TARJETA IGUAL QUE ANTES
  let tarjeta=document.createElement("div");
  tarjeta.className="tarjeta";
  tarjeta.innerHTML=
  "<div id='tarjeta-contenido'><img src='"+urlImagen+"'>"+
  "<div><b>"+nombre+"</b></div>"+
  "<div><b style='color:cyan;'>$"+precio+"</b></div></div>"+
  "<button onclick='verMas(this)'>Ver más</button>"+
  "<button class='btnEliminar' onclick='eliminar(this)'>Eliminar</button>"+
  "<div class='detalle'>" +
  "<div>" + descripcion + "</div>" +
  "<a href='" + ubicacion + "' target='_blank'>Ver ubicación</a>" +
  "</div>";

  document.getElementById("panel-group").appendChild(tarjeta);

  document.getElementById("nombre").value="";
  document.getElementById("descripcion").value="";
  document.getElementById("precio").value="";
  document.getElementById("imagen").value="";
  document.getElementById("ubicacion").value="";
  cerrarForm();
}
async function eliminar(boton){
  let tarjeta = boton.closest(".tarjeta");
  let id = tarjeta.dataset.id; // el id que tiene guardado en Firebase

  if(id){
    await deleteDoc(doc(db, "anuncios", id));
  }

  tarjeta.remove();
}
function verMas(boton){
    let tarjeta=boton.closest(".tarjeta");
    tarjeta.classList.toggle("expandida");

    if(tarjeta.classList.contains("expandida")){
        boton.textContent="Ver menos";
    }else{
        boton.textContent="Ver más";
    }
}
const boton=document.getElementById("menu");
const cuadro=document.getElementById("cuadro-info");
boton.addEventListener("click", function(){
    cuadro.classList.toggle("abierto");
    boton.classList.toggle("mover");});
    window.eliminar=eliminar;
window.confirmar = confirmar;
window.abrirForm = abrirForm;
window.cerrarForm = cerrarForm;
window.verMas = verMas;
window.eliminar = eliminar;
async function cargarAnuncios() {
  let panel = document.getElementById("panel-group");
  panel.innerHTML = "";

  let snapshot = await getDocs(collection(db, "anuncios"));
  snapshot.forEach((documento) => {
    let a = documento.data();

    let tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta";
    tarjeta.dataset.id=documento.id;

    tarjeta.innerHTML =
    "<div class='fila'>"+
    "<div class='lado-img'><img src='"+a.imagen+"'></div>"+
    "<div class='lado-info'>"+
    "<div><b>"+a.nombre+"</b></div>"+
    "<div><b style='color:cyan;'>$"+a.precio+"</b></div>"+
    "</div>"+
    "</div>"+
    "<button onclick='verMas(this)'>Ver más</button>"+
    "<button class='btnEliminar' onclick='eliminar(this)'>Eliminar</button>"+
    "<div class='detalle'><div>"+a.descripcion+"</div><a href='"+a.ubicacion+"' target='_blank'>Ver ubicación</a></div>";
    panel.appendChild(tarjeta);
  });
}

// Que se cargue sola al abrir la página
cargarAnuncios();
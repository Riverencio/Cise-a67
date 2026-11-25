
// Your web app's Firebase configuration

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// TU MISMO firebaseConfig DE TU INTERFAZ
const firebaseConfig = {
  apiKey: "AIzaSyAuYdR8wh9xfX2kAV5EMVjrSNoeyyzS9cU",
  authDomain: "datos-anuncios.firebaseapp.com",
  projectId: "datos-anuncios",
  storageBucket: "datos-anuncios.firebasestorage.app",
  messagingSenderId: "238973626573",
  appId: "1:238973626573:web:d6a336606ebe21a1c16184"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function cargarAnuncios(){
  let datos = await getDocs(collection(db, "anuncios"));
  datos.forEach((doc) => {
    let a = doc.data();
    let tarjeta = document.createElement("div");
    tarjeta.className = "tarjeta";
 tarjeta.innerHTML =
"<div class='fila'>"+"<div class='lado-img'><img src='"+a.imagen+"'></div>"+
"<div class='lado-info'>"+
"<div><b>"+a.nombre+"</b></div>"+
"<div><b style='color:cyan;'>$"+a.precio+"</b></div>"+
"</div>"+
"</div>"+ // <-- AQUÍ FALTABA EL +
"<button onclick='verMas(this)'>Ver más</button>"+
"<div class='detalle'><div>"+a.descripcion+"</div><a href='"+a.ubicacion+"' target='_blank'>Ver ubicación</a></div>"+
"</div>";
    document.getElementById("panel-group").appendChild(tarjeta);
  });
}

window.verMas = function(boton){
  let detalle = boton.parentElement.querySelector(".detalle");
  detalle.style.display = detalle.style.display=="block" ? "none" : "block";
}
window.verMas= function (boton){
    let tarjeta=boton.closest(".tarjeta");
    tarjeta.classList.toggle("expandida");

    if(tarjeta.classList.contains("expandida")){
        boton.textContent="Ver menos";
    }else{
        boton.textContent="Ver más";
    }
}
// ESTA LÍNEA HACE QUE SE CARGUE SOLO, SIN PICARLE A NADA
cargarAnuncios();
function abrirForm(){
    document.getElementById("formulario").classList.add("mostrar");
}
function cerrarForm(){
    document.getElementById("formulario").classList.remove("mostrar");
}
function confirmar(){
    let nombre=document.getElementById("nombre").value;
    let precio=document.getElementById("precio").value;
    let descripcion=document.getElementById("descripcion").value;
    let archivoImagen=document.getElementById("imagen").files[0];
    let urlImagen=archivoImagen ? URL.createObjectURL(archivoImagen) : "";
    let ubicacion=document.getElementById("ubicacion").value;

    if(nombre==""||precio=="")return;

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
function eliminar(boton){
    boton.closest(".tarjeta").remove();
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
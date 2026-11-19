function abrirForm(){
    document.getElementById("formulario").classList.add("mostrar");
}
function cerrarForm(){
    document.getElementById("formulario").classList.remove("mostrar");
}
function confirmar(){
    let nombre=document.getElementById("nombre").value;
    let descripcion=document.getElementById("descripcion").value;
    let precio=document.getElementById("precio").value;

    if(nombre==""||precio=="")return;

    let div=document.createElement("div");
    div.className="tarjeta";
    div.innerHTML="<div><b>"+nombre+"</b></div><div>"+descripcion+"</div><div><b>$"+precio+"</b></div><button class='btnEliminar' onclick='eliminar(this)'>Eliminar</button>";

    document.getElementById("panel-group").appendChild(div);

    document.getElementById("nombre").value="";
    document.getElementById("descripcion").value="";
    document.getElementById("precio").value="";
    cerrarForm();
}
function eliminar(boton){
    boton.closest(".tarjeta").remove();
}
const boton=document.getElementById("menu");
const cuadro=document.getElementById("cuadro-info");
boton.addEventListener("click", function(){
    cuadro.classList.toggle("abierto");
    boton.classList.toggle("mover");});
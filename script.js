const boton=document.getElementById("menu");
const cuadro=document.getElementById("cuadro-info");
boton.addEventListener("click", function(){
    cuadro.classList.toggle("abierto");
    boton.classList.toggle("mover");});
    
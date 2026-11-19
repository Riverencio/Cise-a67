print("Hola");
i=0
while True:
print("Qué operación quieres hacer?")
print("1. Sumar")
print("2. Restar")
print("3. Multiplicar")
print("4. Dividir")
print("5. Salir")
operacion=int(input())
switch operacion:
    case 1:
        print("Ingrese el primer número:")
        num1 = float(input())
        print("Ingrese el segundo número:")
        num2 = float(input())
        resultado = num1 + num2
        print("El resultado de la suma es:", resultado)
    case 2:
        print("Ingrese el primer número:")
        num1 = float(input())
        print("Ingrese el segundo número:")
        num2 = float(input())
        resultado = num1 - num2
        print("El resultado de la resta es:", resultado)
    case 3:
        print("Ingrese el primer número:")
        num1 = float(input())
        print("Ingrese el segundo número:")
        num2 = float(input())
        resultado = num1 * num2
        print("El resultado de la multiplicación es:", resultado)
    case 4:
        print("Ingrese el primer número:")
        num1 = float(input())
        print("Ingrese el segundo número:")
        num2 = float(input())
        if num2 != 0:
            resultado = num1 / num2
            print("El resultado de la división es:", resultado)
        else:
            print("Error: No se puede dividir entre cero.")
    case 5:
        print("Saliendo del programa...")
if not (i!=0):
    break
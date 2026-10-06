# Hub Precios Fruta

App web (vanilla JS, mismo patrón que los otros hubs) para:

1. **Cargar semana** (Compras, viernes): precio presupuesto / actual / máximo esperado
   por fruta. Llega pre-llenada con la semana anterior; se puede pegar desde Excel
   (Ctrl+V sobre la tabla) o subir el "Reporte Semanal Precio Fruta.xlsx". Muestra al
   instante el efecto en los clientes antes de guardar.
2. **Precios por cliente** (Gerencia): vigente → posible → objetivo por unidad de venta,
   semanal o quincenal, desglose de receta al hacer clic, registro del precio aplicado,
   descarga a Excel.
3. **Tendencia**: precio de cada fruta por semana contra presupuesto y máximo.

El correo del lunes a Gerencia y los recordatorios a Compras los manda
`guardian-healthyfood/precios-fruta` (GitHub Actions). La fórmula está en `js/motor.js`
y su espejo `motor.py`; `tests/test_paridad.py` verifica que den idéntico.

- Local: `python serve_dev.py` → http://localhost:8795 (modo demo mientras
  `CLIENT_ID = "PENDIENTE"`; `?demo` lo fuerza).
- `data/recetas.json` (real, de Odoo) **no se sube** (.gitignore): en GitHub Pages el
  modo demo usa `data/recetas_demo.json`, con clientes anónimos y cifras alteradas.

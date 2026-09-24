# Imagen del presentador

Coloca aquí la imagen por defecto del presentador (PNG, JPG o WEBP). Si hay varias, se usa la
primera por orden alfabético. También se puede fijar con la variable `AVATAR_DEFAULT_IMAGE`.

Esta carpeta no se sube a git ni a Cloud Run: la imagen solo existe en tu PC.

Para mejores resultados:

- Busto frontal, mirando a cámara, boca cerrada y expresión neutra.
- Buena luz y la cara de al menos 400 px de alto.
- Encuadre con aire alrededor de la cabeza (el recorte facial se amplía unas 2,3 veces el tamaño de la cara).
- Para YouTube (16:9, formato por defecto) lo ideal es una foto 16:9 de al menos 1920×1080, en plano medio (cabeza y pecho), con la cara ocupando más o menos un tercio del alto. Con otras proporciones la app recorta sola la mayor ventana 16:9 centrada en la cara.
- Si el PNG tiene fondo transparente, se aplana sobre blanco.

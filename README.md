# Clip — editor de video de producto

Editor local con **Remotion + React + TypeScript + Tailwind**, `@remotion/media-utils` y `@remotion/captions`. El nombre oficial es **`@remotion/captions`**, en plural.

## Inicio

Requisitos: Node.js 22+ (verificado con 24), FFmpeg/FFprobe y Chromium. La instalación usa `/usr/bin/chromium` si existe; en otros equipos obtiene Chrome Headless Shell con Remotion.

```bash
npm run setup
npm run dev
```

La UI usa el puerto **5173**, la API el **3001**. `npm run studio` abre el entorno de composición de Remotion; la UI del editor es el flujo recomendado para subir el material.

## Flujo

1. **Video principal**: sube MP4, MOV o WebM, hasta 500 MB. Se decodifica el audio con `getAudioData` y se calcula RMS multicanal en ventanas de 10 ms. Se cortan silencios estrictamente mayores a **0.4 s**, con umbral ajustable (por defecto 0.015, aproximadamente −36 dB). El redondeo de cortes a 30 fps conserva el audio cercano a sus límites. Si no hay audio o falla la decodificación, se conserva el video completo y se muestra el motivo.
2. **Timeline y preview**: se muestran los clips retenidos, puedes saltar a un clip, quitarlo y cambiar su tipo. Los clips Antes/Después hacen zoom **1.0 → 1.15**; Normal desactiva el zoom. Puedes volver a analizar o restaurar el original.
3. **Subtítulos karaoke**: por solicitud del usuario, este proyecto usa un **mock de transcripción para la demo**. Genera texto de ejemplo con tiempos por palabra; **no reconoce las palabras del audio**. La UI lo marca como MODO DEMO. No descarga modelos ni llama Hugging Face. Puedes reemplazarlo con un SRT real; los tiempos por palabra se estiman dentro de cada subtítulo importado. Se remapean después de los cortes y se queman con fondo oscuro y palabra activa resaltada mediante `createTikTokStyleCaptions`.
4. **Sticker de producto**: sube PNG (transparente recomendado), JPG o WebP. Se mantiene abajo a la derecha por encima de todos los clips, sin zoom.
5. **Tres ganchos**: GANCHO 1, 2 y 3 son textos editables. Selecciona una versión en el preview. Cada versión muestra su gancho con animación pop basada en `spring()` durante los **primeros 3 segundos** (o hasta el final si el video es más corto), con aparición y salida suaves.
6. **Exportar los 3**: genera tres MP4 reales, uno por gancho, y ofrece tres descargas. Se procesan secuencialmente para limitar memoria/CPU. También puedes exportar solo la versión seleccionada. Salida **9:16, 1080 × 1920, 30 fps, H.264 + AAC**, audio original y subtítulos quemados. Encuadre centrado. Límite: 30 minutos por video, un trabajo de exportación a la vez.

## Validación

```bash
npm run build        # TypeScript + compilación de la UI
npm test             # detección de silencios, audio estéreo, captions demo y remapeo
npm run test:smoke   # con npm run dev activo y /usr/bin/chromium disponible
```

La prueba smoke genera un video sintético con una pausa de 0.7 s, sube video y sticker desde Chromium, comprueba los cortes y el mock, importa SRT y exporta las tres versiones. FFprobe valida resolución, fps, codec, audio y duración; se comprueba que los tres archivos difieren. Capturas de escritorio/móvil y fotogramas exportados quedan en `.local/`.

## Estructura

- `src/main.tsx`: UI, controles de ganchos y Remotion Player.
- `src/edit.ts`: silencios, remapeo de subtítulos y mock de captions.
- `src/Video.tsx`: clips, zoom, pop del gancho, karaoke y sticker.
- `server/index.ts`: subida, captions demo y trabajos de render.
- `scripts/setup.sh`: instalación repetible y validación.

El material y los MP4 quedan en `.local/`, fuera de Git. El editor es una herramienta local de un usuario. La edición vive en la pestaña y se pierde al recargar. Reiniciar la API pierde el estado de los trabajos; los archivos permanecen. Antes de exponer la API públicamente, añade autenticación, aislamiento de usuarios, cuotas y limpieza de archivos.

## Entorno cloud

Usa el checkout existente `/workspace/-editor`. Las tareas cloud ya están aisladas: no crees worktrees salvo solicitud explícita. El script de instalación y las instrucciones de arranque se guardan en el borrador del entorno. Los procesos deben iniciarse de nuevo en futuras tareas. Guardar el borrador no publica el entorno: la publicación se realiza desde la interfaz del producto.

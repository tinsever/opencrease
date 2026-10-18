declare module "imagetracerjs" {
  const ImageTracer: { imagedataToSVG(data: ImageData, options?: Record<string, unknown>): string };
  export default ImageTracer;
}

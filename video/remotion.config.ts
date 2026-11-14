// Rendering settings for the film. Frames are kept at high quality before encoding: the film is
// mostly text, and text shows compression first.
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(96);
Config.setCodec('h264');
Config.setCrf(15);
Config.setOverwriteOutput(true);

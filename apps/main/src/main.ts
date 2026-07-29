import { LindocaraApi } from "@lindocara/server/api/index.js";
import { Alepha, run } from "alepha";

const alepha = Alepha.create().with(LindocaraApi);

run(alepha);

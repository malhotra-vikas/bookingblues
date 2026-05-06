"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const node_path_1 = require("node:path");
(0, dotenv_1.config)({ path: (0, node_path_1.resolve)(__dirname, '../../../.env.local') });
(0, dotenv_1.config)({ path: (0, node_path_1.resolve)(__dirname, '../../../.env') });
//# sourceMappingURL=setup-env.js.map
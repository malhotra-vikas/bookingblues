"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTestApp = buildTestApp;
const testing_1 = require("@nestjs/testing");
const core_1 = require("@nestjs/core");
const nestjs_pino_1 = require("nestjs-pino");
const auth_module_1 = require("../../src/common/auth/auth.module");
const problem_details_filter_1 = require("../../src/common/filters/problem-details.filter");
const logger_module_1 = require("../../src/common/logger/logger.module");
const supabase_module_1 = require("../../src/common/supabase/supabase.module");
const config_module_1 = require("../../src/config/config.module");
const me_module_1 = require("../../src/modules/me/me.module");
const operators_module_1 = require("../../src/modules/operators/operators.module");
/**
 * Boots a minimal Nest app for integration tests. Uses the same global filter
 * and `/v1` prefix as production.
 */
async function buildTestApp() {
    const moduleRef = await testing_1.Test.createTestingModule({
        imports: [
            config_module_1.ConfigModule,
            logger_module_1.LoggerModule,
            supabase_module_1.SupabaseModule,
            auth_module_1.AuthModule,
            me_module_1.MeModule,
            operators_module_1.OperatorsModule,
        ],
        providers: [
            {
                provide: core_1.APP_FILTER,
                useFactory: (logger) => new problem_details_filter_1.ProblemDetailsFilter(logger),
                inject: [nestjs_pino_1.PinoLogger],
            },
        ],
    }).compile();
    const app = moduleRef.createNestApplication({ bufferLogs: true });
    app.setGlobalPrefix('v1');
    await app.init();
    return app;
}
//# sourceMappingURL=app.js.map
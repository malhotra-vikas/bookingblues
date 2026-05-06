"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const app_1 = require("./helpers/app");
const tenants_1 = require("./helpers/tenants");
(0, tenants_1.describeIfSupabase)('Cross-tenant isolation — operator endpoints', () => {
    let app;
    let tenants;
    beforeAll(async () => {
        app = await (0, app_1.buildTestApp)();
        tenants = await (0, tenants_1.setupTenants)(2);
    });
    afterAll(async () => {
        if (app)
            await app.close();
        if (tenants)
            await (0, tenants_1.teardownTenants)(tenants);
    });
    describe('GET /v1/operators/me', () => {
        it("returns the caller's own operator row", async () => {
            const a = tenants[0];
            const res = await (0, supertest_1.default)(app.getHttpServer())
                .get('/v1/operators/me')
                .set('Authorization', `Bearer ${a.accessToken}`);
            expect(res.status).toBe(200);
            expect(res.body.id).toBe(a.operatorId);
            expect(res.body.user_id).toBe(a.userId);
        });
        it('never leaks tenant B data when called with tenant A token', async () => {
            const a = tenants[0];
            const b = tenants[1];
            const res = await (0, supertest_1.default)(app.getHttpServer())
                .get('/v1/operators/me')
                .set('Authorization', `Bearer ${a.accessToken}`);
            expect(res.status).toBe(200);
            expect(res.body.id).not.toBe(b.operatorId);
            expect(res.body.user_id).not.toBe(b.userId);
        });
        it('returns 401 with no Authorization header', async () => {
            const res = await (0, supertest_1.default)(app.getHttpServer()).get('/v1/operators/me');
            expect(res.status).toBe(401);
            expect(res.body.type).toBeDefined();
            expect(res.body.title).toBeDefined();
        });
        it('returns 401 with a malformed Bearer token', async () => {
            const res = await (0, supertest_1.default)(app.getHttpServer())
                .get('/v1/operators/me')
                .set('Authorization', 'Bearer not-a-real-jwt');
            expect(res.status).toBe(401);
        });
    });
    describe('PATCH /v1/operators/me', () => {
        it("updates only the caller's row", async () => {
            const a = tenants[0];
            const b = tenants[1];
            const newName = `Acme A ${Date.now()}`;
            const res = await (0, supertest_1.default)(app.getHttpServer())
                .patch('/v1/operators/me')
                .set('Authorization', `Bearer ${a.accessToken}`)
                .send({ business_name: newName });
            expect(res.status).toBe(200);
            expect(res.body.business_name).toBe(newName);
            expect(res.body.id).toBe(a.operatorId);
            // Tenant B's row is untouched.
            const bRes = await (0, supertest_1.default)(app.getHttpServer())
                .get('/v1/operators/me')
                .set('Authorization', `Bearer ${b.accessToken}`);
            expect(bRes.body.id).toBe(b.operatorId);
            expect(bRes.body.business_name).not.toBe(newName);
        });
        it('rejects unknown fields (strict zod schema)', async () => {
            const a = tenants[0];
            const res = await (0, supertest_1.default)(app.getHttpServer())
                .patch('/v1/operators/me')
                .set('Authorization', `Bearer ${a.accessToken}`)
                .send({ not_a_real_field: 'x' });
            expect(res.status).toBe(400);
        });
        it('rejects enabling fee without cents', async () => {
            const a = tenants[0];
            const res = await (0, supertest_1.default)(app.getHttpServer())
                .patch('/v1/operators/me')
                .set('Authorization', `Bearer ${a.accessToken}`)
                .send({ booking_fee_enabled: true });
            expect(res.status).toBe(400);
        });
        it('rejects unknown category slug (FK violation surfaces as 400)', async () => {
            const a = tenants[0];
            const res = await (0, supertest_1.default)(app.getHttpServer())
                .patch('/v1/operators/me')
                .set('Authorization', `Bearer ${a.accessToken}`)
                .send({ category: 'underwater_basket_weaving' });
            expect(res.status).toBe(400);
        });
        it('accepts a known category slug from the seed', async () => {
            const a = tenants[0];
            const res = await (0, supertest_1.default)(app.getHttpServer())
                .patch('/v1/operators/me')
                .set('Authorization', `Bearer ${a.accessToken}`)
                .send({ category: 'plumbing' });
            expect(res.status).toBe(200);
            expect(res.body.category).toBe('plumbing');
        });
    });
    describe('GET /v1/operators/me/onboarding-status', () => {
        it('reports per-step booleans + overall completed flag', async () => {
            const a = tenants[0];
            const res = await (0, supertest_1.default)(app.getHttpServer())
                .get('/v1/operators/me/onboarding-status')
                .set('Authorization', `Bearer ${a.accessToken}`);
            expect(res.status).toBe(200);
            expect(res.body.steps).toEqual(expect.objectContaining({
                category: expect.any(Boolean),
                personal_phone: expect.any(Boolean),
                twilio_number: expect.any(Boolean),
                calendar: expect.any(Boolean),
                booking_fee_decided: expect.any(Boolean),
            }));
            expect(typeof res.body.completed).toBe('boolean');
        });
    });
    describe('GET /v1/me', () => {
        it("returns the caller's auth-user record", async () => {
            const a = tenants[0];
            const res = await (0, supertest_1.default)(app.getHttpServer())
                .get('/v1/me')
                .set('Authorization', `Bearer ${a.accessToken}`);
            expect(res.status).toBe(200);
            expect(res.body.id).toBe(a.userId);
            expect(res.body.email).toBe(a.email);
        });
        it('returns 401 without a token', async () => {
            const res = await (0, supertest_1.default)(app.getHttpServer()).get('/v1/me');
            expect(res.status).toBe(401);
        });
    });
});
//# sourceMappingURL=cross-tenant.spec.js.map
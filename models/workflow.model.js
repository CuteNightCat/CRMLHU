// models/workflow.model.js
import mongoose, { Schema, model, models } from 'mongoose';

/**
 * ──────────────────────────────────────────────────────────────────────────────
 * WORKFLOW DATA MODEL (Definition + Instance) — linh hoạt cho nhiều trường hợp
 * - WorkflowDefinition: định nghĩa workflow (nodes = actions, edges = transitions)
 * - WorkflowInstance: phiên chạy cụ thể cho 1 đối tượng (vd: khách hàng)
 * 
 * Hỗ trợ:
 *  - Trigger theo thời gian (delay/datetime/cron) & theo sự kiện (event)
 *  - Condition/guard để chọn nhánh tiếp theo
 *  - Lặp lại có điều kiện (repeat-until/while) & tùy chọn retry khi lỗi
 *  - Cho phép vòng lặp (quay lại node trước) để xử lý các case “đặt lịch mới”
 * ──────────────────────────────────────────────────────────────────────────────
 */

/* ================================ 共 Dùng chung ================================ */

const ConditionSchema = new Schema(
    {
        // Đường dẫn đến dữ liệu để so sánh (path trong context hoặc output của action trước)
        // ví dụ: "context.appointment.date", "lastOutput.status"
        left: { type: String, required: true, trim: true },

        // Toán tử so sánh
        op: {
            type: String,
            enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'regex', 'exists'],
            required: true,
        },

        // Giá trị so sánh bên phải
        right: { type: Schema.Types.Mixed },

        // Nếu cần xử lý đặc biệt (ví dụ so sánh ngày theo timezone), có thể cấu hình thêm:
        options: { type: Schema.Types.Mixed, default: {} },
    },
    { _id: false, strict: true }
);

const DelaySchema = new Schema(
    {
        // Cấu hình delay: hoặc dùng ms trực tiếp, hoặc amount + unit (s/m/h/d)
        ms: { type: Number },
        amount: { type: Number, min: 0 },
        unit: { type: String, enum: ['second', 'minute', 'hour', 'day'] },
    },
    { _id: false }
);

const RepeatPolicySchema = new Schema(
    {
        // Không lặp: none | Lặp tới khi điều kiện đúng: until | Lặp khi điều kiện đúng: while
        mode: { type: String, enum: ['none', 'until', 'while'], default: 'none' },

        // Điều kiện dùng cho repeat-until hoặc repeat-while
        predicate: { type: ConditionSchema, default: null },

        // Lịch lặp: dùng delay hoặc cron
        delay: { type: DelaySchema, default: null },
        cron: { type: String, default: null },

        // Giới hạn lặp
        maxRepeats: { type: Number, default: 0 }, // 0 = không giới hạn

        // Khi gặp lỗi:
        stopOnError: { type: Boolean, default: true }, // true = dừng, false = vẫn tiếp tục theo lịch lặp
    },
    { _id: false }
);

const RetryPolicySchema = new Schema(
    {
        // Có retry khi lỗi không
        enabled: { type: Boolean, default: true },

        // Số lần thử lại tối đa
        maxAttempts: { type: Number, default: 3, min: 0 },

        // backoff: fixed hoặc exponential
        strategy: { type: String, enum: ['fixed', 'exponential'], default: 'exponential' },

        // khoảng chờ giữa các lần retry (ms), nếu exponential thì lần sau = base * 2^attempt
        backoffMs: { type: Number, default: 10_000, min: 0 },
    },
    { _id: false }
);

/* ================================ Trigger ================================ */

const TriggerSchema = new Schema(
    {
        // Các loại tác nhân kích hoạt cho edge (chuyển tiếp)
        type: {
            type: String,
            enum: ['immediate', 'delay', 'datetime', 'cron', 'event', 'condition', 'manual'],
            required: true,
        },

        // delay: chạy sau một khoảng
        delay: { type: DelaySchema, default: null },

        // datetime: chạy vào thời điểm cụ thể
        datetime: { type: Date, default: null },

        // cron: lịch cron
        cron: { type: String, default: null },

        // event: chờ một sự kiện bên ngoài
        event: {
            key: { type: String, trim: true }, // ví dụ: "appointment.created", "appointment.canceled"
            source: { type: String, trim: true }, // tuỳ chọn: hệ thống phát sự kiện
            filter: { type: Schema.Types.Mixed, default: {} }, // điều kiện lọc payload event
        },

        // condition: chỉ chạy khi điều kiện thoả
        condition: { type: ConditionSchema, default: null },

        // Với use case “nhắc lịch hẹn”: nếu thời điểm < 1 ngày thì có thể dùng trigger delay(0) hoặc immediate.
    },
    { _id: false, strict: true }
);

/* ================================ Definition ================================ */

// Một node = 1 hành động
const ActionNodeSchema = new Schema(
    {
        _id: { type: Schema.Types.ObjectId, auto: true },
        key: { type: String, trim: true },
        type: { type: String, required: true, trim: true },
        label: { type: String, trim: true },
        description: { type: String, trim: true },
        config: { type: Schema.Types.Mixed, default: {} },
        reentrant: { type: Boolean, default: true },
        retry: { type: RetryPolicySchema, default: () => ({}) },
        repeat: { type: RepeatPolicySchema, default: () => ({ mode: 'none' }) },

        ui: {
            // (legacy) chỉ để tham khảo, builder grid không dùng
            position: {
                x: { type: Number, default: 0 },
                y: { type: Number, default: 0 },
            },
            // (mới) vị trí theo lưới cố định
            grid: {
                col: { type: Number, default: 1, min: 1 },
                row: { type: Number, default: 1, min: 1 },
            },
            group: { type: String, trim: true, default: null },
            color: { type: String, trim: true, default: null },
            icon: { type: String, trim: true, default: null },
        },
    },
    { _id: true, strict: true }
);

// Edge (chuyển tiếp) giữa 2 node + trigger + guard
const TransitionSchema = new Schema(
    {
        _id: { type: Schema.Types.ObjectId, auto: true },

        from: { type: Schema.Types.ObjectId, required: true }, // _id của ActionNode
        to: { type: Schema.Types.ObjectId, required: true },   // _id của ActionNode

        // Ưu tiên khi có nhiều cạnh thoả điều kiện cùng lúc
        priority: { type: Number, default: 0 },

        // Guard (điều kiện phải đúng mới được đi theo edge này) — đánh giá dựa vào context + output node "from"
        guard: { type: ConditionSchema, default: null },

        // Tác nhân kích hoạt bước tiếp theo
        trigger: { type: TriggerSchema, required: true },

        // Cho phép vòng lặp quay lại? (để explicit trên edge, còn loop thực tế => chỉ cần from/to hợp lệ)
        allowLoop: { type: Boolean, default: true },

        // Cho phép multi-cast (kích hoạt nhiều edge to cùng lúc) nếu guard cùng đúng
        // Nếu false -> chọn edge có priority cao nhất
        allowParallel: { type: Boolean, default: false },

        // Nhãn hiển thị trên UI (ví dụ: "after 1 day", "on canceled")
        label: { type: String, trim: true, default: '' },
    },
    { _id: true, strict: true }
);

// Trigger khởi động workflow
const StartTriggerSchema = new Schema(
    {
        // Có thể khởi động bởi: sự kiện / cron / điều kiện / thủ công
        type: {
            type: String,
            enum: ['event', 'cron', 'datetime', 'manual'],
            required: true,
        },
        event: {
            key: { type: String, trim: true },
            source: { type: String, trim: true },
            filter: { type: Schema.Types.Mixed, default: {} },
        },
        cron: { type: String, default: null },
        datetime: { type: Date, default: null },

        // Node bắt đầu (nếu không chỉ định, mặc định node đầu tiên trong mảng nodes)
        startNodeId: { type: Schema.Types.ObjectId, default: null },
    },
    { _id: false }
);

const WorkflowDefinitionSchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        slug: { type: String, trim: true, index: true },
        description: { type: String, trim: true },

        version: { type: Number, default: 1 },
        isActive: { type: Boolean, default: true },

        // Phân quyền/thuộc về ai
        createdBy: { type: Schema.Types.ObjectId, ref: 'account', required: true },
        ownerId: { type: Schema.Types.ObjectId, ref: 'account', default: null },
        workspaceId: { type: Schema.Types.ObjectId, ref: 'workspace', default: null },

        // Nodes & Edges
        nodes: { type: [ActionNodeSchema], default: [] },
        edges: { type: [TransitionSchema], default: [] },

        // Khởi động
        start: { type: StartTriggerSchema, default: null },

        // Schema context mặc định cho instance (key-value ban đầu)
        defaultContext: { type: Schema.Types.Mixed, default: {} },

        // Ràng buộc: cho phép loop?
        allowCycles: { type: Boolean, default: true },

        // Tag/nhãn
        tags: { type: [String], default: [] },
    },
    {
        timestamps: true,
        strict: true,
    }
);

WorkflowDefinitionSchema.index({ createdBy: 1, slug: 1 }, { unique: false });
WorkflowDefinitionSchema.index({ isActive: 1 });
WorkflowDefinitionSchema.index({ 'nodes.type': 1 });

/* ================================ Instance ================================ */

const StepExecutionSchema = new Schema(
    {
        nodeId: { type: Schema.Types.ObjectId, required: true }, // tham chiếu _id trong nodes
        nodeType: { type: String, trim: true },

        // Thử lại & lặp
        attempt: { type: Number, default: 0 }, // số lần attempt (retry)
        repeatCount: { type: Number, default: 0 }, // số lần lặp theo repeat policy

        // Liên kết với job của Agenda để quản trị (tuỳ chọn)
        agendaJobId: { type: Schema.Types.ObjectId, default: null },

        // Trạng thái thực thi
        status: {
            type: String,
            enum: ['queued', 'running', 'success', 'skipped', 'failed', 'canceled'],
            default: 'queued',
        },

        startedAt: { type: Date, default: null },
        finishedAt: { type: Date, default: null },

        // Kết quả đầu ra của node này (để guard/condition sử dụng)
        output: { type: Schema.Types.Mixed, default: {} },

        // Thông tin lỗi (nếu có)
        error: {
            message: { type: String, default: null },
            code: { type: String, default: null },
            stack: { type: String, default: null },
            raw: { type: Schema.Types.Mixed, default: null },
        },

        // Edge đã chọn để đi tiếp (nếu đơn nhánh)
        takenEdgeId: { type: Schema.Types.ObjectId, default: null },
    },
    { _id: false }
);

const WaitingTriggerSchema = new Schema(
    {
        // Lưu lại những trigger đang chờ để engine/Agenda theo dõi
        edgeId: { type: Schema.Types.ObjectId, required: true },
        fromNodeId: { type: Schema.Types.ObjectId, required: true },
        toNodeId: { type: Schema.Types.ObjectId, required: true },

        trigger: { type: TriggerSchema, required: true },

        // Nếu là event: chờ event key nào
        eventKey: { type: String, trim: true, default: null },

        // Nếu là time-based: job đã tạo chưa
        agendaJobId: { type: Schema.Types.ObjectId, default: null },

        // TTL optional (tuỳ flow): hết hạn chờ
        expiresAt: { type: Date, default: null },
    },
    { _id: true }
);

const WorkflowInstanceSchema = new Schema(
    {
        definitionId: { type: Schema.Types.ObjectId, ref: 'workflow_definition', required: true },

        // Đối tượng mục tiêu (ví dụ: customer)
        target: {
            type: {
                type: String, default: 'customer', trim: true, // tuỳ domain: "customer", "lead", ...
            },
            id: { type: Schema.Types.ObjectId, required: true },
            display: { type: String, trim: true, default: '' },
        },

        // Bối cảnh chạy (dữ liệu runtime thay đổi theo khách hàng/phiên)
        context: { type: Schema.Types.Mixed, default: {} },

        // Trạng thái phiên
        status: {
            type: String,
            enum: ['pending', 'running', 'paused', 'completed', 'failed', 'canceled'],
            default: 'pending',
            index: true,
        },

        // Nhiều node có thể hoạt động song song
        activeNodeIds: { type: [Schema.Types.ObjectId], default: [] },

        // Lịch sử thực thi từng bước
        history: { type: [StepExecutionSchema], default: [] },

        // Những trigger đang chờ (event/time)
        waiting: { type: [WaitingTriggerSchema], default: [] },

        // Thông tin tổng kết/kết quả cuối
        result: { type: Schema.Types.Mixed, default: {} },

        startedAt: { type: Date, default: null },
        finishedAt: { type: Date, default: null },

        // Ai khởi tạo
        createdBy: { type: Schema.Types.ObjectId, ref: 'account', required: true },

        // Tham chiếu giúp query nhanh (ví dụ theo khách hàng)
        customerId: { type: Schema.Types.ObjectId, ref: 'customer', default: null },

        // Nhãn/nhóm
        tags: { type: [String], default: [] },
    },
    { timestamps: true, strict: true }
);

WorkflowInstanceSchema.index({ definitionId: 1, status: 1 });
WorkflowInstanceSchema.index({ 'target.id': 1, status: 1 });
WorkflowInstanceSchema.index({ startedAt: 1 });
WorkflowInstanceSchema.index({ finishedAt: 1 });

/* ================================ Models ================================ */

export const WorkflowDefinition =
    models.workflow_definition || model('workflow_definition', WorkflowDefinitionSchema);

export const WorkflowInstance =
    models.workflow_instance || model('workflow_instance', WorkflowInstanceSchema);

/* Các thức sử dụng/workflow engine:
1) Tạo workflow:
   - Tạo nodes (actions) + edges (transitions) với trigger/guard.
   - Có thể cấu hình start trigger (event/cron/datetime) hoặc tự tạo instance thủ công.

2) Chạy workflow cho 1 khách hàng:
   - Tạo WorkflowInstance với context/target.
   - Engine/Agenda sẽ đọc definition, push job cho node bắt đầu.
   - Sau khi node xong, xét edges từ node đó:
       + Kiểm tra guard; nếu true → chuẩn bị trigger tương ứng.
       + Trigger time: schedule job bằng Agenda.
       + Trigger event: thêm vào instance.waiting, đợi API event gọi vào, rồi tiếp tục.
       + Trigger condition: nếu đúng → tiếp; chưa đúng → áp dụng repeat policy node.

3) Lặp lại có điều kiện & retry:
   - Node.repeat quyết định lặp khi “chưa đạt điều kiện” (không phải lỗi).
   - Node.retry dành cho lỗi (exception/failed).
   - Transition.allowParallel cho phép bắn nhiều nhánh cùng lúc nếu cần.

4) Vòng lặp lịch hẹn:
   - Tạo edge từ node sau quay về node “Thông báo hẹn” với trigger.event = "appointment.created|updated|canceled".
   - Khi lịch thay đổi, event đến → instance tiếp tục/loop lại node thông báo. */

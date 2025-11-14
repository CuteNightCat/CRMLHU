import { Schema, model, models } from 'mongoose';

const AssignmentHistorySchema = new Schema(
    {
        customer: {
            type: Schema.Types.ObjectId,
            ref: 'customer',
            required: true
        },
        assignedBy: {
            type: Schema.Types.ObjectId,
            ref: 'user',
            required: true
        },
        assignedTo: {
            type: Schema.Types.ObjectId,
            ref: 'user',
            required: true
        },
        assignedAt: {
            type: Date,
            default: Date.now
        },
        notes: {
            type: String
        }
    },
    { timestamps: true }
);

const AssignmentHistory = 
    models.assignmenthistory || model('assignmenthistory', AssignmentHistorySchema);

export default AssignmentHistory;

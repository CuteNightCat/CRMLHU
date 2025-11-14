import { Schema, model, models } from "mongoose";

const AssignmentLogSchema = new Schema(
  {
    customer: { 
      type: Schema.Types.ObjectId, 
      ref: 'customer', 
      required: true 
    },
    assignedTo: { 
      type: Schema.Types.ObjectId, 
      ref: 'user', 
      required: true 
    },
    assignedBy: { 
      type: Schema.Types.ObjectId, 
      ref: 'user', 
      required: true 
    },
    notes: { 
      type: String,
      default: "" 
    }
  },
  { timestamps: true }
);

const AssignmentLog = models.assignmentlog || model("assignmentlog", AssignmentLogSchema);

export default AssignmentLog;

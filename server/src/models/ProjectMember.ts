import { Schema, model, Types } from 'mongoose';

export interface IProjectMember {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceRole: string;
  projectRole: string;
  responsibilities: string[];
  status: 'active' | 'invited' | 'removed';
  joinedAt?: Date;
}

const projectMemberSchema = new Schema<IProjectMember>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceRole: { type: String, required: true },
    projectRole: { type: String, required: true },
    responsibilities: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'invited', 'removed'], default: 'active' },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

projectMemberSchema.index({ projectId: 1, userId: 1 }, { unique: true });

export const ProjectMember = model<IProjectMember>('ProjectMember', projectMemberSchema);

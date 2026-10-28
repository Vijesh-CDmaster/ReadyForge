import { Schema, model, Types } from 'mongoose';

export const COMMENT_ENTITY_TYPES = ['conflict', 'contract', 'project', 'task'] as const;
export type CommentEntityType = (typeof COMMENT_ENTITY_TYPES)[number];

export interface IComment {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  projectId?: Types.ObjectId;
  entityType: CommentEntityType;
  entityId: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  /** One level of threading: replies point at a top-level comment. */
  parentId?: Types.ObjectId;
  /** Users resolved from @mentions in the body. */
  mentions: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<IComment>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    entityType: { type: String, enum: COMMENT_ENTITY_TYPES, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, maxlength: 4000, trim: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Comment' },
    mentions: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
  },
  { timestamps: true }
);

export const Comment = model<IComment>('Comment', commentSchema);

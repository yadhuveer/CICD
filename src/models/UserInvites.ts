import mongoose, { Schema, Document } from "mongoose";

export interface IInvite extends Document {
  name: string;
  email: string;
  role: "admin" | "editor" | "User" | string;
  status: "pending" | "accepted" | "expired" | "active" | string;
  invitedBy: string;
  invitedByEmail?: string;
  token: string;
  expiresAt: Date;
}

const InviteSchema = new Schema<IInvite>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, required: true, default: "User" },
    status: {
      type: String,
      enum: ["pending", "accepted", "expired", "active"],
      default: "pending",
    },
    invitedBy: { type: String, required: true },
    invitedByEmail: { type: String },
    token: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export default mongoose.model<IInvite>("UserInvite", InviteSchema);

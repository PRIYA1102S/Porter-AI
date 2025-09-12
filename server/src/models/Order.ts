import mongoose, { Document, Schema } from "mongoose";

export interface IOrder extends Document {
  customerName?: string;
  address?: string;
  item: string;
  qty: number;
  status: string;
  pickupTime?: Date | null;
  assignedTo?: string;
  trackingId: string;
  metadata?: any;
  createdAt?: Date;
  updatedAt?: Date;
  amount?: number; // Add amount field for earnings
  expenses?: number; // Add expenses field for expenses
}

const OrderSchema = new Schema<IOrder>(
  {
    customerName: { type: String },
    address: { type: String },
    item: { type: String, required: true },
    qty: { type: Number, default: 1 },
    status: { type: String, default: "created" },
    pickupTime: { type: Date, default: null },
    assignedTo: { type: String, default: null },
    trackingId: { type: String, required: true, unique: true },
    metadata: { type: Schema.Types.Mixed },
    amount: { type: Number, default: 200 }, // Default earning per order
    expenses: { type: Number, default: 50 }, // Default expense per order
  },
  { timestamps: true }
);

export default mongoose.model<IOrder>("Order", OrderSchema);

import { Schema, model, type Types } from 'mongoose';

/** Extracted text per PDF page — the citation viewer and re-chunking read from here. */
export interface IMaterialPage {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  projectId: Types.ObjectId;
  materialId: Types.ObjectId;
  pageNumber: number;
  text: string;
  method: 'text' | 'ocr';
  charCount: number;
  sectionTitle: string | null;
}

const materialPageSchema = new Schema<IMaterialPage>(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    materialId: { type: Schema.Types.ObjectId, required: true },
    pageNumber: { type: Number, required: true },
    text: { type: String, default: '' },
    method: { type: String, enum: ['text', 'ocr'], default: 'text' },
    charCount: { type: Number, default: 0 },
    sectionTitle: { type: String, default: null },
  },
  { timestamps: true },
);
materialPageSchema.index({ materialId: 1, pageNumber: 1 }, { unique: true });
materialPageSchema.index({ projectId: 1 });

export const MaterialPage = model<IMaterialPage>('MaterialPage', materialPageSchema, 'material_pages');

/** Retrieval unit: page-aware text span with its embedding and linked concepts. */
export interface IChunk {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  projectId: Types.ObjectId;
  materialId: Types.ObjectId;
  index: number;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  text: string;
  tokenEstimate: number;
  embedding: number[];
  conceptIds: Types.ObjectId[];
  flags: { suspectedInjection: boolean };
}

const chunkSchema = new Schema<IChunk>(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    materialId: { type: Schema.Types.ObjectId, required: true },
    index: { type: Number, required: true },
    pageStart: { type: Number, required: true },
    pageEnd: { type: Number, required: true },
    sectionTitle: { type: String, default: null },
    text: { type: String, required: true },
    tokenEstimate: { type: Number, default: 0 },
    // Large: excluded from queries unless explicitly selected (+embedding).
    embedding: { type: [Number], default: [], select: false },
    conceptIds: { type: [Schema.Types.ObjectId], default: [] },
    flags: { suspectedInjection: { type: Boolean, default: false } },
  },
  { timestamps: true },
);
chunkSchema.index({ materialId: 1, index: 1 }, { unique: true });
chunkSchema.index({ projectId: 1, conceptIds: 1 });
// Compound text index: every lexical query must pin a projectId (equality prefix) — isolation by construction.
chunkSchema.index({ projectId: 1, text: 'text', sectionTitle: 'text' }, { name: 'chunk_text', weights: { text: 3, sectionTitle: 1 } });

export const Chunk = model<IChunk>('Chunk', chunkSchema, 'chunks');

/** A concept the learner should master, merged across all materials of a Project. */
export interface IConcept {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  slug: string;
  description: string;
  /** 0–1 (from the extractor's 1–5 rating). */
  importance: number;
  sources: Array<{ materialId: Types.ObjectId; pages: number[] }>;
  embedding: number[];
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const conceptSchema = new Schema<IConcept>(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, maxlength: 120 },
    slug: { type: String, required: true },
    description: { type: String, default: '', maxlength: 600 },
    importance: { type: Number, default: 0.5, min: 0, max: 1 },
    sources: {
      type: [new Schema({ materialId: Schema.Types.ObjectId, pages: [Number] }, { _id: false })],
      default: [],
    },
    embedding: { type: [Number], default: [], select: false },
    chunkCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
conceptSchema.index({ projectId: 1, slug: 1 }, { unique: true });
conceptSchema.index({ projectId: 1, importance: -1 });

export const Concept = model<IConcept>('Concept', conceptSchema, 'concepts');

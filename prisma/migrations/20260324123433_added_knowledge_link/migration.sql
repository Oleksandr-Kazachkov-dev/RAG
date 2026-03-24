-- CreateTable
CREATE TABLE "knowledge_links" (
    "id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "label" VARCHAR(500) NOT NULL,
    "context" TEXT NOT NULL,
    "sourceFile" VARCHAR(500) NOT NULL,
    "linkType" VARCHAR(50) NOT NULL,
    "keywords" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "knowledge_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_links_label_idx" ON "knowledge_links"("label");

-- CreateIndex
CREATE INDEX "knowledge_links_keywords_idx" ON "knowledge_links"("keywords");

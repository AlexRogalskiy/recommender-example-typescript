/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable dot-notation */
import * as dotenv from "dotenv";
import { Vector, utils } from '@pinecone-database/pinecone';
import { getEnv } from "utils/util.ts";
import { getPineconeClient } from "utils/pinecone.ts";
import cliProgress from "cli-progress";
import { Document } from 'langchain/document';
import * as dfd from "danfojs-node";
import { embedder } from "embeddings.ts";
import loadCSVFile from "utils/csvLoader.ts";
import splitFile from "utils/fileSplitter.ts";
import { SquadRecord, loadSquad } from "./utils/squadLoader.js";

interface ArticleRecord {
  title: string;
  article: string;
  publication: string;
  url: string;
  author: string;
}



dotenv.config();
const { createIndexIfNotExists, chunkedUpsert } = utils;

const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

// Index setup
const indexName = getEnv("PINECONE_INDEX");
const pineconeClient = await getPineconeClient();


async function getChunk(df: dfd.DataFrame, start: number, size: number): Promise<dfd.DataFrame> {
  // eslint-disable-next-line no-return-await
  return await df.head(start + size).tail(size);
}

async function* processInChunks(dataFrame: dfd.DataFrame, chunkSize: number): AsyncGenerator<Document[]> {
  for (let i = 0; i < dataFrame.shape[0]; i += chunkSize) {
    const chunk = await getChunk(dataFrame, i, chunkSize);
    const records = dfd.toJSON(chunk) as ArticleRecord[];
    yield records.map((record: ArticleRecord) => new Document({
      pageContent: record.article,
      metadata: {
        url: record["url"],
        title: record["title"],
        publication: record["publication"],
        author: record["author"],
      },
    }));
  }
}

async function embedAndUpsert(dataFrame: dfd.DataFrame, chunkSize: number) {
  const chunkGenerator = processInChunks(dataFrame, chunkSize);
  const index = pineconeClient.Index(indexName);


  for await (const documents of chunkGenerator) {
    await embedder.embedBatch(documents, chunkSize, async (embeddings: Vector[]) => {
      await chunkedUpsert(index, embeddings, "default");
      progressBar.increment(embeddings.length);
    });
  }
}

try {
  // const fileParts = await splitFile("./all-the-news-2-1.csv", 1000000);
  // const firstFile = fileParts[0];

  const data = await loadCSVFile(`./all-the-news-2-1.csv.1`);
  data.head().print();

  // squadData.print();
  await createIndexIfNotExists(pineconeClient, indexName, 384);
  progressBar.start(data.shape[0], 0);
  await embedder.init("Xenova/all-MiniLM-L6-v2");
  await embedAndUpsert(data, 1);

  progressBar.stop();
  console.log(`Inserted ${progressBar.getTotal()} documents into index ${indexName}`);

} catch (error) {
  console.error(error);
}

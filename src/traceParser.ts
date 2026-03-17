import yauzl from 'yauzl';
import fs from 'fs';

/**
 * Extracts the last HTML snapshot from a Playwright trace.zip file.
 * Returns the path to the extracted file, or undefined if not found.
 */
export async function extractHtmlSnapshot(zipPath: string, outputPath: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        return resolve(undefined);
      }

      let bestSnapshotEntry: yauzl.Entry | null = null;
      let lastTime = 0;

      zipfile.readEntry();
      zipfile.on('entry', (entry: yauzl.Entry) => {
        // Find .html files in the resources/ folder (this is where DOM snapshots are stored)
        if (entry.fileName.endsWith('.html') && entry.fileName.startsWith('resources/')) {
          // Update to the latest one based on LastModified
          if (entry.getLastModDate().getTime() > lastTime || !bestSnapshotEntry) {
            bestSnapshotEntry = entry;
            lastTime = entry.getLastModDate().getTime();
          }
        }
        zipfile.readEntry();
      });

      zipfile.on('end', () => {
        if (!bestSnapshotEntry) {
          return resolve(undefined);
        }

        // Reopen to extract the best one
        yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile2) => {
          if (err || !zipfile2) {
            return resolve(undefined);
          }

          zipfile2.readEntry();
          zipfile2.on('entry', (entry: yauzl.Entry) => {
            if (entry.fileName === bestSnapshotEntry!.fileName) {
              zipfile2.openReadStream(entry, (err, readStream) => {
                if (err || !readStream) {
                  zipfile2.close();
                  return resolve(undefined);
                }
                const writeStream = fs.createWriteStream(outputPath);
                readStream.pipe(writeStream);
                writeStream.on('finish', () => {
                  zipfile2.close();
                  resolve(outputPath);
                });
                writeStream.on('error', () => {
                  zipfile2.close();
                  resolve(undefined);
                });
              });
            } else {
              zipfile2.readEntry();
            }
          });
        });
      });

      zipfile.on('error', () => resolve(undefined));
    });
  });
}

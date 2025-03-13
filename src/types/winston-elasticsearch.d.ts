declare module 'winston-elasticsearch' {
  import TransportStream from 'winston-transport';

  export interface ElasticsearchTransportOptions {
    level?: string;
    clientOpts: object;
  }

  export class ElasticsearchTransport extends TransportStream {
    constructor(opts: ElasticsearchTransportOptions);
  }

  export function ElasticsearchTransformer(): unknown;
}

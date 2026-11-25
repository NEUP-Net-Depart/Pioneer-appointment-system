export interface PagesBindings {
  vars: Record<string, string>;
  d1_databases: { binding: string; database_name: string; database_id: string; migrations_dir: string }[];
  r2_buckets: { binding: string; bucket_name: string }[];
  analytics_engine_datasets?: { binding: string; dataset: string }[];
}

export interface PagesConfig extends PagesBindings {
  $schema?: string;
  name: string;
  pages_build_output_dir: string;
  compatibility_date: string;
  compatibility_flags: string[];
  env: { preview: PagesBindings };
}

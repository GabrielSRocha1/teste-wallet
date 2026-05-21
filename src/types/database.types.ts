export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type JsonObject = { [key: string]: Json | undefined }

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      balances: {
        Row: {
          bdc_balance: number
          brl_offchain: number
          brt_balance: number
          esct_balance: number
          last_sync_at: string | null
          sync_source: string | null
          updated_at: string
          updated_by_system: boolean
          usdc_balance: number
          usdt_balance: number
          user_id: string
          verum_balance: number
        }
        Insert: {
          bdc_balance?: number
          brl_offchain?: number
          brt_balance?: number
          esct_balance?: number
          last_sync_at?: string | null
          sync_source?: string | null
          updated_at?: string
          updated_by_system?: boolean
          usdc_balance?: number
          usdt_balance?: number
          user_id: string
          verum_balance?: number
        }
        Update: {
          bdc_balance?: number
          brl_offchain?: number
          brt_balance?: number
          esct_balance?: number
          last_sync_at?: string | null
          sync_source?: string | null
          updated_at?: string
          updated_by_system?: boolean
          usdc_balance?: number
          usdt_balance?: number
          user_id?: string
          verum_balance?: number
        }
        Relationships: [
          {
            foreignKeyName: "balances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      contratos_vesting: {
        Row: {
          created_at: string
          data_desbloqueio: string | null
          data_fim: string | null
          data_inicio: string
          duracao_meses: number
          hash: string | null
          id: string
          metadata: Json | null
          moeda: string
          preco_investimento: number | null
          public_key: string
          quantidade_tokens: number
          status: string
          tipo_contrato: string
          total_liberado: number
          ultimo_release: string | null
          updated_at: string | null
          usuario_id: string
          valor_investimento: number
        }
        Insert: {
          created_at?: string
          data_desbloqueio?: string | null
          data_fim?: string | null
          data_inicio: string
          duracao_meses?: number
          hash?: string | null
          id?: string
          metadata?: Json | null
          moeda: string
          preco_investimento?: number | null
          public_key: string
          quantidade_tokens: number
          status?: string
          tipo_contrato?: string
          total_liberado?: number
          ultimo_release?: string | null
          updated_at?: string | null
          usuario_id: string
          valor_investimento: number
        }
        Update: {
          created_at?: string
          data_desbloqueio?: string | null
          data_fim?: string | null
          data_inicio?: string
          duracao_meses?: number
          hash?: string | null
          id?: string
          metadata?: Json | null
          moeda?: string
          preco_investimento?: number | null
          public_key?: string
          quantidade_tokens?: number
          status?: string
          tipo_contrato?: string
          total_liberado?: number
          ultimo_release?: string | null
          updated_at?: string | null
          usuario_id?: string
          valor_investimento?: number
        }
        Relationships: [
          {
            foreignKeyName: "contratos_vesting_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      deposit_orders: {
        Row: {
          amount_brl: number
          amount_sol: number | null
          amount_usdt: number | null
          celcoin_e2e_id: string | null
          celcoin_tx_id: string | null
          confirmed_at: string | null
          created_at: string
          cryptomus_order_id: string | null
          cryptomus_payment_url: string | null
          exchange_rate: number
          expected_usdt: number
          expires_at: string
          id: string
          paid_at: string | null
          payment_method: string
          pix_copy_paste: string | null
          pix_qr_code: string | null
          processed_by_ip: string | null
          provider: string
          saga_completed_at: string | null
          saga_error: string | null
          saga_step: string
          sol_price_brl: number | null
          status: string
          tx_signature: string | null
          updated_at: string
          user_id: string
          wallet_address: string | null
          webhook_payload: Json | null
          webhook_signature: string | null
        }
        Insert: {
          amount_brl: number
          amount_sol?: number | null
          amount_usdt?: number | null
          celcoin_e2e_id?: string | null
          celcoin_tx_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          cryptomus_order_id?: string | null
          cryptomus_payment_url?: string | null
          exchange_rate: number
          expected_usdt: number
          expires_at: string
          id?: string
          paid_at?: string | null
          payment_method?: string
          pix_copy_paste?: string | null
          pix_qr_code?: string | null
          processed_by_ip?: string | null
          provider?: string
          saga_completed_at?: string | null
          saga_error?: string | null
          saga_step?: string
          sol_price_brl?: number | null
          status?: string
          tx_signature?: string | null
          updated_at?: string
          user_id: string
          wallet_address?: string | null
          webhook_payload?: Json | null
          webhook_signature?: string | null
        }
        Update: {
          amount_brl?: number
          amount_sol?: number | null
          amount_usdt?: number | null
          celcoin_e2e_id?: string | null
          celcoin_tx_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          cryptomus_order_id?: string | null
          cryptomus_payment_url?: string | null
          exchange_rate?: number
          expected_usdt?: number
          expires_at?: string
          id?: string
          paid_at?: string | null
          payment_method?: string
          pix_copy_paste?: string | null
          pix_qr_code?: string | null
          processed_by_ip?: string | null
          provider?: string
          saga_completed_at?: string | null
          saga_error?: string | null
          saga_step?: string
          sol_price_brl?: number | null
          status?: string
          tx_signature?: string | null
          updated_at?: string
          user_id?: string
          wallet_address?: string | null
          webhook_payload?: Json | null
          webhook_signature?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deposit_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_orders_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["address"]
          },
        ]
      }
      ecosystem_tokens: {
        Row: {
          created_at: string
          description: string | null
          id: string
          investment_pitch: string | null
          is_active: boolean
          max_investment: number
          min_investment: number
          token_symbol: string
          website_url: string | null
          whitepaper_url: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          investment_pitch?: string | null
          is_active?: boolean
          max_investment?: number
          min_investment?: number
          token_symbol: string
          website_url?: string | null
          whitepaper_url?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          investment_pitch?: string | null
          is_active?: boolean
          max_investment?: number
          min_investment?: number
          token_symbol?: string
          website_url?: string | null
          whitepaper_url?: string | null
        }
        Relationships: []
      }
      exchange_rates: {
        Row: {
          fiat_currency: string
          id: string
          rate: number
          source: string
          token_symbol: string
          updated_at: string
        }
        Insert: {
          fiat_currency?: string
          id?: string
          rate: number
          source?: string
          token_symbol: string
          updated_at?: string
        }
        Update: {
          fiat_currency?: string
          id?: string
          rate?: number
          source?: string
          token_symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      kyc_checks: {
        Row: {
          applicant_id: string
          country: string
          created_at: string
          doc_type: string | null
          id: string
          moderation_comment: string | null
          provider: string
          review_result: Json | null
          review_status: string
          updated_at: string
          user_id: string
          webhook_payload: Json | null
        }
        Insert: {
          applicant_id: string
          country: string
          created_at?: string
          doc_type?: string | null
          id?: string
          moderation_comment?: string | null
          provider?: string
          review_result?: Json | null
          review_status: string
          updated_at?: string
          user_id: string
          webhook_payload?: Json | null
        }
        Update: {
          applicant_id?: string
          country?: string
          created_at?: string
          doc_type?: string | null
          id?: string
          moderation_comment?: string | null
          provider?: string
          review_result?: Json | null
          review_status?: string
          updated_at?: string
          user_id?: string
          webhook_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "kyc_checks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_profiles: {
        Row: {
          cpf: string
          created_at: string
          data_nascimento: string
          id: string
          nacionalidade: string
          nome: string
          sobrenome: string
          status: string
          updated_at: string
          user_id: string
          verificado: boolean
          verificado_em: string | null
        }
        Insert: {
          cpf: string
          created_at?: string
          data_nascimento: string
          id?: string
          nacionalidade?: string
          nome: string
          sobrenome: string
          status?: string
          updated_at?: string
          user_id: string
          verificado?: boolean
          verificado_em?: string | null
        }
        Update: {
          cpf?: string
          created_at?: string
          data_nascimento?: string
          id?: string
          nacionalidade?: string
          nome?: string
          sobrenome?: string
          status?: string
          updated_at?: string
          user_id?: string
          verificado?: boolean
          verificado_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kyc_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      market_data: {
        Row: {
          change_24h: number
          id: string
          is_live: boolean
          pair: string
          price: number
          updated_at: string
          volume_24h: number
        }
        Insert: {
          change_24h?: number
          id?: string
          is_live?: boolean
          pair: string
          price: number
          updated_at?: string
          volume_24h?: number
        }
        Update: {
          change_24h?: number
          id?: string
          is_live?: boolean
          pair?: string
          price?: number
          updated_at?: string
          volume_24h?: number
        }
        Relationships: []
      }
      notificacoes: {
        Row: {
          created_at: string
          data: Json | null
          descricao: string
          id: string
          lida: boolean
          moeda: string | null
          tipo: string
          titulo: string
          user_id: string
          valor: number | null
        }
        Insert: {
          created_at?: string
          data?: Json | null
          descricao: string
          id?: string
          lida?: boolean
          moeda?: string | null
          tipo: string
          titulo: string
          user_id: string
          valor?: number | null
        }
        Update: {
          created_at?: string
          data?: Json | null
          descricao?: string
          id?: string
          lida?: boolean
          moeda?: string | null
          tipo?: string
          titulo?: string
          user_id?: string
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      price_feeds: {
        Row: {
          change_24h: number | null
          currency: string
          id: string
          last_updated: string
          market_cap: number | null
          price: number
          source: string
          token_symbol: string
          volume_24h: number | null
        }
        Insert: {
          change_24h?: number | null
          currency?: string
          id?: string
          last_updated?: string
          market_cap?: number | null
          price: number
          source?: string
          token_symbol: string
          volume_24h?: number | null
        }
        Update: {
          change_24h?: number | null
          currency?: string
          id?: string
          last_updated?: string
          market_cap?: number | null
          price?: number
          source?: string
          token_symbol?: string
          volume_24h?: number | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          created_at: string
          device_id: string
          id: string
          is_active: boolean
          platform: string
          push_token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          is_active?: boolean
          platform?: string
          push_token: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          is_active?: boolean
          platform?: string
          push_token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      refresh_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          revoked_at: string | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          revoked_at?: string | null
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refresh_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      security_logs: {
        Row: {
          created_at: string
          event_description: string | null
          event_type: string
          id: string
          ip_address: string | null
          metadata: Json | null
          success: boolean
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_description?: string | null
          event_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          success?: boolean
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_description?: string | null
          event_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          success?: boolean
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      supported_tokens: {
        Row: {
          coingecko_id: string | null
          created_at: string
          decimals: number
          id: string
          is_active: boolean
          is_native: boolean
          is_stablecoin: boolean
          logo_url: string | null
          mint_address: string
          name: string
          symbol: string
        }
        Insert: {
          coingecko_id?: string | null
          created_at?: string
          decimals?: number
          id?: string
          is_active?: boolean
          is_native?: boolean
          is_stablecoin?: boolean
          logo_url?: string | null
          mint_address: string
          name: string
          symbol: string
        }
        Update: {
          coingecko_id?: string | null
          created_at?: string
          decimals?: number
          id?: string
          is_active?: boolean
          is_native?: boolean
          is_stablecoin?: boolean
          logo_url?: string | null
          mint_address?: string
          name?: string
          symbol?: string
        }
        Relationships: []
      }
      swap_orders: {
        Row: {
          confirmed_at: string | null
          created_at: string
          error_message: string | null
          expected_output: number
          fee_amount: number
          fee_token: string
          id: string
          input_amount: number
          input_token: string
          on_chain_tx_hash: string | null
          output_amount: number | null
          output_token: string
          price_impact_pct: number | null
          quote_id: string | null
          route_plan: Json | null
          slippage_bps: number
          status: string
          user_id: string
          wallet_address: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          error_message?: string | null
          expected_output: number
          fee_amount?: number
          fee_token?: string
          id?: string
          input_amount: number
          input_token: string
          on_chain_tx_hash?: string | null
          output_amount?: number | null
          output_token: string
          price_impact_pct?: number | null
          quote_id?: string | null
          route_plan?: Json | null
          slippage_bps?: number
          status?: string
          user_id: string
          wallet_address: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          error_message?: string | null
          expected_output?: number
          fee_amount?: number
          fee_token?: string
          id?: string
          input_amount?: number
          input_token?: string
          on_chain_tx_hash?: string | null
          output_amount?: number | null
          output_token?: string
          price_impact_pct?: number | null
          quote_id?: string | null
          route_plan?: Json | null
          slippage_bps?: number
          status?: string
          user_id?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "swap_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      swap_pairs: {
        Row: {
          created_at: string
          fee_percentage: number
          from_token: string
          id: string
          is_active: boolean
          liquidity_source: string
          max_amount: number
          min_amount: number
          to_token: string
        }
        Insert: {
          created_at?: string
          fee_percentage?: number
          from_token: string
          id?: string
          is_active?: boolean
          liquidity_source?: string
          max_amount?: number
          min_amount?: number
          to_token: string
        }
        Update: {
          created_at?: string
          fee_percentage?: number
          from_token?: string
          id?: string
          is_active?: boolean
          liquidity_source?: string
          max_amount?: number
          min_amount?: number
          to_token?: string
        }
        Relationships: []
      }
      transaction_fees: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          fee_type: string
          id: string
          token: string
          transaction_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          fee_type: string
          id?: string
          token?: string
          transaction_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          fee_type?: string
          id?: string
          token?: string
          transaction_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          block_slot: number | null
          blockchain: string
          blockchain_tx_hash: string | null
          confirmations: number
          confirmed_at: string | null
          created_at: string
          currency: string
          deposit_order_id: string | null
          description: string | null
          direction: string | null
          fee: number
          from_wallet: string | null
          id: string
          idempotency_key: string | null
          metadata: Json | null
          status: string
          to_wallet: string | null
          type: string
          usd_value_at_time: number | null
          user_id: string
          wallet_address: string | null
        }
        Insert: {
          amount: number
          block_slot?: number | null
          blockchain?: string
          blockchain_tx_hash?: string | null
          confirmations?: number
          confirmed_at?: string | null
          created_at?: string
          currency: string
          deposit_order_id?: string | null
          description?: string | null
          direction?: string | null
          fee?: number
          from_wallet?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          status?: string
          to_wallet?: string | null
          type: string
          usd_value_at_time?: number | null
          user_id: string
          wallet_address?: string | null
        }
        Update: {
          amount?: number
          block_slot?: number | null
          blockchain?: string
          blockchain_tx_hash?: string | null
          confirmations?: number
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          deposit_order_id?: string | null
          description?: string | null
          direction?: string | null
          fee?: number
          from_wallet?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          status?: string
          to_wallet?: string | null
          type?: string
          usd_value_at_time?: number | null
          user_id?: string
          wallet_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_deposit_order_id_fkey"
            columns: ["deposit_order_id"]
            isOneToOne: false
            referencedRelation: "deposit_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_from_wallet_fkey"
            columns: ["from_wallet"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["address"]
          },
          {
            foreignKeyName: "transactions_to_wallet_fkey"
            columns: ["to_wallet"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["address"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activities: {
        Row: {
          created_at: string
          details: string | null
          id: string
          ip_address: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          ip_address?: string | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          ip_address?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      user_documents: {
        Row: {
          country: string
          created_at: string
          doc_number: string
          doc_type: string
          id: string
          updated_at: string
          user_id: string
          verified: boolean
          verified_at: string | null
        }
        Insert: {
          country: string
          created_at?: string
          doc_number: string
          doc_type: string
          id?: string
          updated_at?: string
          user_id: string
          verified?: boolean
          verified_at?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          doc_number?: string
          doc_type?: string
          id?: string
          updated_at?: string
          user_id?: string
          verified?: boolean
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      user_investments: {
        Row: {
          amount_invested: number
          created_at: string
          ecosystem_token_id: string
          id: string
          status: string
          token_price_at_invest: number
          tokens_received: number
          user_id: string
          vesting_contract_id: string | null
        }
        Insert: {
          amount_invested: number
          created_at?: string
          ecosystem_token_id: string
          id?: string
          status?: string
          token_price_at_invest: number
          tokens_received: number
          user_id: string
          vesting_contract_id?: string | null
        }
        Update: {
          amount_invested?: number
          created_at?: string
          ecosystem_token_id?: string
          id?: string
          status?: string
          token_price_at_invest?: number
          tokens_received?: number
          user_id?: string
          vesting_contract_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_investments_ecosystem_token_id_fkey"
            columns: ["ecosystem_token_id"]
            isOneToOne: false
            referencedRelation: "ecosystem_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_investments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_investments_vesting_contract_id_fkey"
            columns: ["vesting_contract_id"]
            isOneToOne: false
            referencedRelation: "contratos_vesting"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          auto_lock_timeout: number
          biometric_enabled: boolean
          biometric_type: string
          created_at: string
          email_notifications: boolean
          fiat_currency: string
          hide_balance: boolean
          language: string
          network: string
          price_alerts: boolean
          push_notifications: boolean
          security_notifications: boolean
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_lock_timeout?: number
          biometric_enabled?: boolean
          biometric_type?: string
          created_at?: string
          email_notifications?: boolean
          fiat_currency?: string
          hide_balance?: boolean
          language?: string
          network?: string
          price_alerts?: boolean
          push_notifications?: boolean
          security_notifications?: boolean
          theme?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_lock_timeout?: number
          biometric_enabled?: boolean
          biometric_type?: string
          created_at?: string
          email_notifications?: boolean
          fiat_currency?: string
          hide_balance?: boolean
          language?: string
          network?: string
          price_alerts?: boolean
          push_notifications?: boolean
          security_notifications?: boolean
          theme?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      usuarios: {
        Row: {
          country: string
          created_at: string
          email: string | null
          external_kyc_id: string | null
          id: string
          kyc_provider: string | null
          kyc_review_status: string | null
          kyc_status: string
          kyc_verified_at: string | null
          nome_completo: string | null
          senha_criptografada: string | null
          telefone: string | null
          updated_at: string
          wallet_address: string | null
        }
        Insert: {
          country?: string
          created_at?: string
          email?: string | null
          external_kyc_id?: string | null
          id: string
          kyc_provider?: string | null
          kyc_review_status?: string | null
          kyc_status?: string
          kyc_verified_at?: string | null
          nome_completo?: string | null
          senha_criptografada?: string | null
          telefone?: string | null
          updated_at?: string
          wallet_address?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          email?: string | null
          external_kyc_id?: string | null
          id?: string
          kyc_provider?: string | null
          kyc_review_status?: string | null
          kyc_status?: string
          kyc_verified_at?: string | null
          nome_completo?: string | null
          senha_criptografada?: string | null
          telefone?: string | null
          updated_at?: string
          wallet_address?: string | null
        }
        Relationships: []
      }
      vesting_releases: {
        Row: {
          contrato_id: string
          created_at: string
          data_release: string
          erro: string | null
          hash_onchain: string | null
          id: string
          numero_release: number
          quantidade_liberada: number
          status: string
        }
        Insert: {
          contrato_id: string
          created_at?: string
          data_release: string
          erro?: string | null
          hash_onchain?: string | null
          id?: string
          numero_release: number
          quantidade_liberada: number
          status?: string
        }
        Update: {
          contrato_id?: string
          created_at?: string
          data_release?: string
          erro?: string | null
          hash_onchain?: string | null
          id?: string
          numero_release?: number
          quantidade_liberada?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "vesting_releases_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contratos_vesting"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          address: string
          blockchain: string
          created_at: string
          id: string
          is_active: boolean
          user_id: string
        }
        Insert: {
          address: string
          blockchain?: string
          created_at?: string
          id?: string
          is_active?: boolean
          user_id: string
        }
        Update: {
          address?: string
          blockchain?: string
          created_at?: string
          id?: string
          is_active?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          error_message: string | null
          headers: Json
          id: string
          idempotency_key: string | null
          ip_address: string
          payload: Json
          processed_at: string
          provider: string
          signature: string | null
          success: boolean
        }
        Insert: {
          error_message?: string | null
          headers: Json
          id?: string
          idempotency_key?: string | null
          ip_address: string
          payload: Json
          processed_at?: string
          provider: string
          signature?: string | null
          success: boolean
        }
        Update: {
          error_message?: string | null
          headers?: Json
          id?: string
          idempotency_key?: string | null
          ip_address?: string
          payload?: Json
          processed_at?: string
          provider?: string
          signature?: string | null
          success?: boolean
        }
        Relationships: []
      }
      withdraw_orders: {
        Row: {
          amount_brl: number | null
          amount_pyg: number | null
          amount_token: number
          bank_name: string | null
          created_at: string
          currency_fiat: string
          error_message: string | null
          fee_amount: number
          id: string
          pix_key: string | null
          status: string
          swap_tx_hash: string | null
          token_symbol: string
          transfer_receipt: string | null
          updated_at: string
          user_id: string
          wallet_address: string
        }
        Insert: {
          amount_brl?: number | null
          amount_pyg?: number | null
          amount_token: number
          bank_name?: string | null
          created_at?: string
          currency_fiat?: string
          error_message?: string | null
          fee_amount?: number
          id?: string
          pix_key?: string | null
          status?: string
          swap_tx_hash?: string | null
          token_symbol?: string
          transfer_receipt?: string | null
          updated_at?: string
          user_id: string
          wallet_address: string
        }
        Update: {
          amount_brl?: number | null
          amount_pyg?: number | null
          amount_token?: number
          bank_name?: string | null
          created_at?: string
          currency_fiat?: string
          error_message?: string | null
          fee_amount?: number
          id?: string
          pix_key?: string | null
          status?: string
          swap_tx_hash?: string | null
          token_symbol?: string
          transfer_receipt?: string | null
          updated_at?: string
          user_id?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdraw_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      transacoes: {
        Row: {
          id: string
          user_id: string
          remetente_id: string
          destinatario_id: string | null
          tipo: string
          valor: number
          moeda: string
          hash: string
          status: string
          descricao: string
          created_at: string
        }
        Insert: {
          [_ in never]: never
        }
        Update: {
          [_ in never]: never
        }
        Relationships: []
      }
    }
    Functions: {
      get_user_balance: {
        Args: {
          p_user_id: string
          p_moeda: string
        }
        Returns: number
      }
      get_all_balances: {
        Args: {
          p_user_id: string
        }
        Returns: Array<{
          moeda: string
          saldo: number
        }>
      }
      process_ledger_operation: {
        Args: {
          p_user_id: string
          p_type: string
          p_amount: number
          p_currency?: string
          p_idempotency_key?: string | null
          p_destinatario_id?: string | null
          p_swap_dest_currency?: string | null
          p_swap_dest_amount?: number | null
          p_metadata?: Json | null
          p_description?: string | null
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// ── Helper types ──────────────────────────────────────────────────────────────
// Exportados aqui para que database.ts e outros serviços possam importar
// de um único lugar sem criar dependência circular.

export type TableName = keyof Database['public']['Tables']
export type ViewName  = keyof Database['public']['Views']

export type Row<T extends TableName | ViewName> =
  T extends TableName
    ? Database['public']['Tables'][T]['Row']
    : T extends ViewName
    ? Database['public']['Views'][T]['Row']
    : never

export type InsertRow<T extends TableName> = Database['public']['Tables'][T]['Insert']
export type UpdateRow<T extends TableName> = Database['public']['Tables'][T]['Update']

export type FiatCurrency = 'BRL' | 'USD' | 'PYG' | 'EUR'
export type PriceSource  = 'coingecko' | 'binance' | 'internal' | 'manual'
export type SecurityEventType =
  | 'login'
  | 'logout'
  | 'biometric_auth'
  | 'export_key'
  | 'export_mnemonic'
  | 'wallet_created'
  | 'wallet_recovered'
  | 'lock'
  | 'unlock'
  | 'failed_login'
export type VestingStatus = 'active' | 'completed' | 'cancelled' | 'paused'
export type SwapStatus    = 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled'

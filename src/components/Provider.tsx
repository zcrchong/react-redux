import type { Context, ReactNode } from 'react'
import * as React from 'react'
import type { ReactReduxContextValue } from './Context'
import { ReactReduxContext } from './Context'
import { createSubscription } from '../utils/Subscription'
import { useIsomorphicLayoutEffect } from '../utils/useIsomorphicLayoutEffect'
import type { Action, AnyAction, Store } from 'redux'
import type { CheckFrequency } from '../hooks/useSelector'
/**
 * 第一部分： Provider注入Store
 * Provider 做了哪些事。
1 首先知道 React-Redux 是通过 context 上下文来保存传递 Store 的，但是上下文 value 保存的除了 Store 还有 subscription 。
2 subscription 可以理解为订阅器，在 React-redux 中一方面用来订阅来自 state 变化，另一方面通知对应的组件更新。在 Provider 中的订阅器 subscription 为根订阅器，
3 在 Provider 的 useEffect 中，进行真正的绑定订阅功能，其原理内部调用了 store.subscribe ，只有根订阅器才会触发store.subscribe，至于为什么，马上就会讲到。

 * */
export interface ProviderProps<A extends Action = AnyAction, S = unknown> {
  /**
   * 应用中的单个 Redux 存储。
   * 这里的 <S, A> 是 TypeScript 中的泛型，分别代表 Redux 的状态（State）和动作（Action）。
   */
  store: Store<S, A> // 定义一个类型为Store<S, A>的变量store

  /**
   * 可选的服务器状态快照。在初始 hydration 渲染期间，如果可用，将用于确保 UI 输出与在服务器上生成的 HTML 一致。
   */
  serverState?: S // 定义一个类型为S的可选变量serverState

  /**
   * 可选的上下文，用于在 react-redux 内部使用。使用 React.createContext() 创建要使用的上下文。
   * 如果使用此选项，您需要通过向 Provider 提供的相同上下文来自定义 `connect`。
   * 初始值不重要，因为它被重写为 Provider 的内部状态。
   */
  context?: Context<ReactReduxContextValue<S, A>> // 定义一个类型为Context<ReactReduxContextValue<S, A>>的可选变量context

  /** `useSelector`稳定性检查的全局配置 */
  stabilityCheck?: CheckFrequency // 定义一个类型为CheckFrequency的可选变量stabilityCheck，用于`useSelector`稳定性检查的全局配置

  /** `useSelector` no-op 检查的全局配置 */
  noopCheck?: CheckFrequency // 定义一个类型为CheckFrequency的可选变量noopCheck，用于`useSelector` no-op 检查的全局配置

  /** 子组件 */
  children: ReactNode // 定义一个类型为ReactNode的变量children，代表子组件
}

function Provider<A extends Action = AnyAction, S = unknown>({
  store,
  context,
  children,
  serverState,
  stabilityCheck = 'once',
  noopCheck = 'once',
}: ProviderProps<A, S>) {
  /* 利用useMemo，跟据store的变化创建出一个contextValue 包含一个根元素订阅器和当前store  */
  const contextValue = React.useMemo(() => {
    /* 创建了一个根级 Subscription 订阅器 */
    const subscription = createSubscription(store)
    /* 根据store 改变创建新的contextValue */
    return {
      store,
      subscription,
      getServerState: serverState ? () => serverState : undefined,
      stabilityCheck,
      noopCheck,
    }
  }, [store, serverState, stabilityCheck, noopCheck])

  const previousState = React.useMemo(() => store.getState(), [store])

  useIsomorphicLayoutEffect(() => {
    const { subscription } = contextValue
    subscription.onStateChange = subscription.notifyNestedSubs
    /* 触发trySubscribe方法执行，创建listens */
    subscription.trySubscribe() // 发起订阅

    if (previousState !== store.getState()) {
      subscription.notifyNestedSubs()
    }
    return () => {
      // 卸载订阅
      subscription.tryUnsubscribe()
      subscription.onStateChange = undefined
    }
  }, [contextValue, previousState]) // /*  contextValue state 改变出发新的 effect */

  const Context = context || ReactReduxContext

  // @ts-ignore 'AnyAction' is assignable to the constraint of type 'A', but 'A' could be instantiated with a different subtype
  // 有一种类型 'AnyAction' 可以赋值给类型 'A'，但 'A' 可能会用不同的子类型进行实例化。
  return <Context.Provider value={contextValue}>{children}</Context.Provider>
}

export default Provider

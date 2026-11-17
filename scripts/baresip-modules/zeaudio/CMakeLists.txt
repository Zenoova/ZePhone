project(zeaudio)

set(SRCS zeaudio.c)

if(STATIC)
  add_library(${PROJECT_NAME} OBJECT ${SRCS})
else()
  add_library(${PROJECT_NAME} MODULE ${SRCS})
endif()

if(MSVC)
  # C11 atomics (_Atomic, <stdatomic.h>) are opt-in in MSVC.
  target_compile_options(${PROJECT_NAME} PRIVATE /experimental:c11atomics)
endif()
